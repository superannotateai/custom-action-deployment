# Github Actions: SuperAnnotate Custom Actions Sync

A Github Action that automatically updates or creates custom actions in SuperAnnotate directly from your GitHub repo.

## YAML Definition

Add the following snippet to the script section of your `.github/workflows/deploy.yml` file:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: superannotateai/custom-action-deployment@{latest version i.e. 0.0.1)
with:
sa_token: ${{  secrets.SA_TOKEN  }} # Required. SuperAnnotate authentication token
```

## Variables

| Variable   | Type   | Required | Description                                                             |
| ---------- | ------ | -------- | ----------------------------------------------------------------------- |
| `SA_TOKEN` | String | Yes      | This is your team's SuperAnnotate SDK token. Add this as a repo secret. |

## Repo Structure

Your repo must contain an `actions` folder. Each custom action should be its own folder inside the `actions/` folder with the following structure:

```
actions/
  └── custom_action_folder/ # Required. Should match the custom action name in SuperAnnotate.
      ├── config.yaml    # Required. Custom action configuration.
      └── main.py        # Required. Custom action python script.
```

The name of the custom action folder will be the name of the custom action in SuperAnnotate.

The custom action python file should always be titled `main.py`.

### Example of required config.yaml structure

The `config.yaml` file must always contain the following required fields:

- `description`: Task description
- `memory`: Memory allocation
- `interpreter`: Python interpreter version/path
- `time_limit`: Time limit for task execution
- `concurrency`: Concurrency settings
- `requirements`: Python packages list

Example `config.yaml`:

```yaml
# Description of what the custom action does
description: "My custom task description"
# Memory in MB . Allowed values: 128, 256, 512, 768, 1024, 1536, 2048, 3008
memory: 256
# Python Interpreter version. Allowed values: "3.10", "3.11", "3.12", "3.13"
interpreter: "3.11"
# Execution time limit (in minutes). Allowed values range from 5 minutes to 180 minutes, in 1-minute increments. Must be an integer.
time_limit: 5
# Concurrency limit (1 to 128)
concurrency: 32
# List of Python libraries to install
requirements:
  - "superannotate==4.5.1"
  - "numpy==1.23.0"
```

## How It Works

1. **Change Detection**: The pipe detects which folders in `actions/` were modified in the current commit.
2. **Validation**: For each changed folder, it validates the folder structure and the `config.yaml` structure.
3. **Custom Action Lookup**: Checks if a custom action with the same name already exists in SuperAnnotate.
4. **Sync Operation**:
   - **New Custom Action**: Creates a new custom action if such didn't exist
   - **Existing Custom Action**: Updates the custom action.
     - If only main.py file was updated (not `config.yaml`), updates only the python code.
     - If `config.yaml` was updated, updates configuration.

## Example

### In a Deployment Pipeline

```yaml
name: Build and Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and Deploy
        uses: superannotateai/custom-action-deployment@0.0.1
        with:
          sa_token: ${{ secrets.SA_TOKEN }}
```

## Error Handling

- **Missing sa_token**: The pipeline will fail if `sa_token` is not provided.
- **Invalid config.yaml**: Syntax and validation errors will cause the pipeline to fail.
- **Missing Files**: Folders without `config.yaml` or `main.py` will be skipped with a warning.
- **API Errors**: Failed API requests to SuperAnnotate are logged but do not fail the pipeline.  
  When processing multiple folders, folders are handled sequentially and each produces independent API calls. A failure in one folder does not affect the others.

## Output

The pipe provides detailed logging:

- ✅ Success messages for created/updated custom actions
- ⚠️ Warnings for skipped folders
- ❌ Error messages for failures
- 🔍 Status updates during processing

## License

Copyright (c) 2025 SuperAnnotate. All rights reserved.

## Support

For issues or questions, please contact:

- **Maintainer**: Superannotate
- **Email**: support@superannotate.com
