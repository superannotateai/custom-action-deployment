#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const yaml = require("js-yaml");
const https = require("https");
const http = require("http");
// Configuration
const SA_URL = process.env.SA_URL || "https://zimmer.superannotate.com";
const SA_API_URL = `${SA_URL}/api/v1.1/custom_task`;
const SA_TOKEN = process.env?.SA_TOKEN || null;
const VERSION = "0.0.1";
const ghRange = getGitRangeFromGithubEvent();

// GitLab CI variables take precedence
const GIT_BEFORE =
  process.env.GIT_BEFORE ||
  process.env.CI_COMMIT_BEFORE_SHA ||
  ghRange?.before ||
  null;

const GIT_AFTER =
  process.env.GIT_AFTER ||
  process.env.CI_COMMIT_SHA ||
  ghRange?.after ||
  process.env.GITHUB_SHA ||
  "HEAD";

function ensureCommitExists(sha) {
  if (!sha || /^0{40}$/.test(sha)) return false;
  try {
    execSync(`git cat-file -e ${sha}^{commit}`, { stdio: "ignore" });
    return true;
  } catch {
    // try to fetch more history
    try {
      execSync(`git fetch --no-tags --prune --depth=200 origin`, {
        stdio: "ignore",
      });
      execSync(`git cat-file -e ${sha}^{commit}`, { stdio: "ignore" });
      return true;
    } catch {
      // last attempt: full fetch
      try {
        execSync(`git fetch --no-tags --prune --unshallow origin`, {
          stdio: "ignore",
        });
        execSync(`git cat-file -e ${sha}^{commit}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }
  }
}

function getGitRangeFromGithubEvent() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !fs.existsSync(eventPath)) return null;

    const evt = JSON.parse(fs.readFileSync(eventPath, "utf-8"));

    // push event
    if (evt.before && evt.after) {
      return { before: evt.before, after: evt.after };
    }

    // pull_request event
    if (evt.pull_request?.base?.sha && evt.pull_request?.head?.sha) {
      return {
        before: evt.pull_request.base.sha,
        after: evt.pull_request.head.sha,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function getChangedFiles() {
  try {
    const cwd = process.cwd();
    try {
      execSync(`git config --global --add safe.directory "${cwd}"`, {
        encoding: "utf-8",
        stdio: "ignore",
      });
    } catch (_) {}

    // If we can't compute a safe range, fall back to last commit only
    if (!GIT_BEFORE || /^0{40}$/.test(GIT_BEFORE)) {
      const out = execSync(
        `git show --name-only --pretty="format:" ${GIT_AFTER}`,
        {
          encoding: "utf-8",
        },
      );
      return out.split("\n").filter((f) => f.trim());
    }

    // Make sure both commits exist locally
    const beforeOk = ensureCommitExists(GIT_BEFORE);
    const afterOk = ensureCommitExists(GIT_AFTER);

    if (!beforeOk || !afterOk) {
      console.warn(
        `⚠️  Cannot find commit(s) locally. beforeOk=${beforeOk} afterOk=${afterOk}. Falling back to last commit.`,
      );
      const out = execSync(
        `git show --name-only --pretty="format:" ${GIT_AFTER}`,
        {
          encoding: "utf-8",
        },
      );
      return out.split("\n").filter((f) => f.trim());
    }

    const out = execSync(
      `git diff --name-only --diff-filter=ACMRT ${GIT_BEFORE}..${GIT_AFTER}`,
      { encoding: "utf-8" },
    );
    return out.split("\n").filter((f) => f.trim());
  } catch (e) {
    console.error("Error getting changed files:", e.message);
    return [];
  }
}

/**
 * Sanitize token by removing "Bearer " prefix and all whitespace
 */
function sanitizeToken(token) {
  if (!token) return "";

  // Remove "Bearer " prefix if present
  let cleanToken = token.replace(/^[Bb]earer\s+/, "");

  // Remove all whitespace (newlines, spaces, tabs)
  cleanToken = cleanToken.replace(/\s+/g, "");

  return cleanToken;
}

/**
 * Get changed files in a specific folder
 */
function getChangedFilesInFolder(folder) {
  try {
    const normalizedFolder = folder.replace(/\/$/, "") + "/";
    const changedFiles = getChangedFiles();
    return changedFiles
      .filter((file) => file.startsWith(normalizedFolder))
      .map((file) => file.replace(normalizedFolder, ""));
  } catch (error) {
    console.error(`Error getting changed files in ${folder}:`, error.message);
    return [];
  }
}

/**
 * Get changed folders in actions/ directory
 */

function getChangedFolders() {
  try {
    const changedFiles = getChangedFiles();
    const folders = new Set();

    changedFiles.forEach((file) => {
      if (file.startsWith("actions/")) {
        const parts = file.split("/");
        if (parts.length >= 2) {
          folders.add(`actions/${parts[1]}`);
        }
      }
    });

    return Array.from(folders);
  } catch (error) {
    console.error("Error detecting changed folders:", error.message);
    return [];
  }
}

/**
 * Find config file (config.yaml or config.yml)
 */
function findConfigFile(folder) {
  const configYamlPath = path.join(folder, "config.yaml");
  const configYmlPath = path.join(folder, "config.yml");

  if (fs.existsSync(configYamlPath)) {
    return configYamlPath;
  }
  if (fs.existsSync(configYmlPath)) {
    return configYmlPath;
  }
  return null;
}

/**
 * Get config filename (for display purposes)
 */
function getConfigFileName(folder) {
  const configYamlPath = path.join(folder, "config.yaml");
  const configYmlPath = path.join(folder, "config.yml");

  if (fs.existsSync(configYamlPath)) {
    return "config.yaml";
  }
  if (fs.existsSync(configYmlPath)) {
    return "config.yml";
  }
  return "config.yaml or config.yml";
}

/**
 * Validate config.yaml/config.yml structure - check only if required keys exist
 */
function validateConfig(config, folder) {
  const errors = [];
  const requiredKeys = [
    "description",
    "memory",
    "interpreter",
    "time_limit",
    "concurrency",
  ];

  // Check if all required keys exist
  for (const key of requiredKeys) {
    if (!(key in config)) {
      errors.push(`'${key}' is required`);
    }
  }

  if (errors.length > 0) {
    const configFileName = getConfigFileName(folder);
    return {
      error: `Invalid ${configFileName} in ${folder}:\n  - ${errors.join(
        "\n  - ",
      )}`,
    };
  }

  return null;
}

/**
 * Generate JSON payload from folder
 */
function generatePayload(folder) {
  try {
    const configPath = findConfigFile(folder);

    // Check if config.yaml or config.yml exists
    if (!configPath) {
      return { error: "No config.yaml or config.yml found" };
    }

    // Load config
    let config;
    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      config = yaml.load(configContent);
    } catch (error) {
      return { error: `Invalid YAML: ${error.message}` };
    }

    // Validate config structure
    const validationError = validateConfig(config, folder);
    if (validationError) {
      return validationError;
    }

    // Find main.py file specifically
    const mainPyPath = path.join(folder, "main.py");

    if (!fs.existsSync(mainPyPath)) {
      return { error: "No main.py file found" };
    }

    // Read and encode the Python file content as base64
    const fileContent = fs.readFileSync(mainPyPath);
    const encodedFile = fileContent.toString("base64");

    // Determine task name
    const taskName = path.basename(folder);
    // Construct config object
    const taskConfig = config;
    taskConfig.interpreter = config.interpreter;
    taskConfig.requirements = config.requirements;
    // Multiply time_limit by 60 if set
    const timeLimit = config.time_limit
      ? config.time_limit * 60
      : config.time_limit;
    taskConfig.time_limit = timeLimit;

    // Construct payload
    const payload = {
      name: taskName,
      description: config.description,
      memory: config.memory,
      time_limit: timeLimit,
      concurrency: config.concurrency,
      config: taskConfig,
      file: encodedFile,
    };

    return payload;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Generate minimal payload with only file content (for PATCH when only .py changed)
 */
function generateFileOnlyPayload(folder) {
  try {
    // Find main.py file specifically
    const mainPyPath = path.join(folder, "main.py");

    if (!fs.existsSync(mainPyPath)) {
      return { error: "No main.py file found" };
    }

    // Read and encode the Python file content as base64
    const fileContent = fs.readFileSync(mainPyPath);
    const encodedFile = fileContent.toString("base64");

    // Return only file in payload
    return {
      file: encodedFile,
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Make HTTP request
 */
function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const httpModule = isHttps ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = httpModule.request(requestOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Check if custom task exists
 */
async function checkTaskExists(name, apiToken) {
  const url = new URL(SA_API_URL);
  url.searchParams.append("name", name);

  try {
    const response = await makeRequest(url.toString(), {
      method: "GET",
      headers: {
        Authorization: apiToken,
        "Auth-Type": "sdk",
        Referer: "https://app.superannotate.com/",
        "Content-Type": "application/json",
        "User-Agent": `Github Pipeline: ${VERSION}`,
      },
    });
    // Parse ID from response
    const id = response.data?.results?.[0]?.id || response.data?.id || null;
    return id;
  } catch (error) {
    console.error("Error checking task existence:", error.message);
    return null;
  }
}

/**
 * Create or update custom task
 */
async function syncTask(folder, apiToken) {
  // Remove trailing slash
  const cleanFolder = folder.replace(/\/$/, "");

  // Check if config.yaml or config.yml exists
  const configPath = findConfigFile(cleanFolder);
  if (!configPath) {
    console.log(
      `⚠️  Skipping ${cleanFolder}: No config.yaml or config.yml found.`,
    );
    return;
  }

  // Check if main.py exists
  if (!fs.existsSync(path.join(cleanFolder, "main.py"))) {
    console.log(`⚠️  Skipping ${cleanFolder}: No main.py found.`);
    return;
  }

  const configFileName = path.basename(configPath);
  console.log(`🔧 Processing folder: ${cleanFolder}`);
  console.log(` 📄 Found ${configFileName}`);
  console.log(` 📄 Found main.py`);

  // Generate full payload first (needed for task name)
  const fullPayload = generatePayload(cleanFolder);
  if (fullPayload.error) {
    console.error(`❌ Error processing ${cleanFolder}: ${fullPayload.error}`);
    // Validation errors should fail the pipeline
    if (
      fullPayload.error.includes("Invalid config.yaml") ||
      fullPayload.error.includes("Invalid config.yml")
    ) {
      process.exit(1);
    }
    return;
  }

  const taskName = fullPayload.name;

  // Check if task exists
  console.log(`🔍 Checking existence`);
  const taskId = await checkTaskExists(taskName, apiToken);

  try {
    if (!taskId) {
      console.log(`🆕 Creating new action: ${taskName}`);

      // For new tasks, always use full payload
      const response = await makeRequest(
        SA_API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiToken,
            "Auth-Type": "sdk",
            Referer: "https://app.superannotate.com/",
            "User-Agent": `Github Pipeline: ${VERSION}`,
          },
        },
        fullPayload,
      );
      if (response.status >= 200 && response.status < 300) {
        console.log(`✔ Created successfully (${response.data?.id})`);
      } else {
        console.error(
          `❌ Failed to create task: ${JSON.stringify(response.data)}`,
        );
      }
    } else {
      console.log(`✔ Existing task found (id=${taskId})`);
      // Check what files changed in this folder
      const changedFiles = getChangedFilesInFolder(cleanFolder);
      const onlyPyFilesChanged =
        changedFiles.length > 0 &&
        changedFiles.every((file) => file == "main.py") &&
        !changedFiles.some(
          (file) => file === "config.yaml" || file === "config.yml",
        );

      let patchPayload;
      if (onlyPyFilesChanged) {
        patchPayload = generateFileOnlyPayload(cleanFolder);
        if (patchPayload.error) {
          console.warn(
            `⚠️  Error generating file-only payload, using full payload: ${patchPayload.error}`,
          );
          patchPayload = fullPayload;
        }
      } else {
        patchPayload = fullPayload;
      }
      console.log(`♻ Updating action: ${taskName}`);
      const response = await makeRequest(
        `${SA_API_URL}/${taskId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiToken,
            "Auth-Type": "sdk",
            Referer: "https://app.superannotate.com/",
            "User-Agent": `Github Pipeline: ${VERSION}`,
          },
        },
        patchPayload,
      );
      if (response.status >= 200 && response.status < 300) {
        console.log(`✔ Update successful`);
      } else {
        console.error(
          `❌ Failed to update task: ${JSON.stringify(response.data)}`,
        );
      }
    }
  } catch (error) {
    console.error(`❌ Error syncing task ${taskName}:`, error.message);
  } finally {
    console.log("----------------------------------");
  }
}

/**
 * Main function
 */
async function main() {
  // Check if SA_TOKEN is set - fail immediately if not
  if (!SA_TOKEN) {
    console.error("Please check environment variables.");
    console.error("Ensure SA_TOKEN is defined.");
    process.exit(1);
  }

  // Sanitize token
  const apiToken = sanitizeToken(SA_TOKEN);

  // Get changed folders
  const changedFolders = getChangedFolders();

  // Process each changed folder
  for (const folder of changedFolders) {
    await syncTask(folder, apiToken);
  }
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = {
  sanitizeToken,
  getChangedFilesInFolder,
  getChangedFolders,
  generatePayload,
  generateFileOnlyPayload,
  checkTaskExists,
  syncTask,
};
