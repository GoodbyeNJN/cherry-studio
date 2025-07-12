# External Control Usage

## Overview

To provide a more flexible and powerful way to interact with the Cherry Studio app, we have introduced an external control feature. This allows users to control the app from external scripts or applications.

See more details on [Discussion](https://github.com/CherryHQ/cherry-studio/discussions/2379) and [Pull Request](https://github.com/CherryHQ/cherry-studio/pull/8043).

## Usage

To use the external control feature, follow these steps:

1. **Enable External Control**: In the Cherry Studio app settings, enable the "External Control" option in the "Keyboard Shortcuts" section.

2. **Select Server Type**: Choose the type of server you want to use for external control. The available options are:

   - **HTTP**: Use a HTTP server for communication.
   - **Unix Domain Socket**: Use a Unix Domain Socket for communication (only available on Linux/macOS).

3. **Set HTTP Port**: Configure the HTTP port for the external control server. The default port is `9090`, but you can change it to any available port.

4. **Send Commands**: You can send commands to the Cherry Studio app using HTTP requests or Unix Domain Socket messages. For example:

   - **HTTP Request**:
     ```bash
     curl -X POST http://localhost:9090 -d '{"cmd": "showApplication"}'
     ```
   - **Unix Domain Socket Message**:
     ```bash
     echo '{"cmd": "showApplication"}' | nc -U /tmp/CherryStudio/cherry-studio.sock
     # Or
     echo '{"cmd": "showApplication"}' | socat - /tmp/CherryStudio/cherry-studio.sock
     ```

## Payload Format

The payload for the external control commands should be a JSON object with the following structure:

```jsonc
{
  "cmd": "command_name",
  "arg1": "value1",
  "arg2": "value2",
  // ...
  "argN": "valueN"
}
```

### Available Commands and Arguments

1. `showApplication`: Show the Cherry Studio app window.

   - No arguments.

2. `toggleApplication`: Toggle the visibility of the Cherry Studio app window.

   - No arguments.

3. `showQuickAssistant`: Show the Quick Assistant panel.

   - `route` (string, optional): The route to navigate to when showing the Quick Assistant. If not provided, it defaults to the current route. Available routes are:
     - `home`
     - `chat`
     - `translate`
     - `summary`
     - `explanation`
   - `userInputText` (string, optional): The text to pre-fill in the Quick Assistant input field. If not provided, it defaults to an empty string.
   - `clipboardText` (string, optional): The text to reference as the clipboard content in the Quick Assistant. If not provided, it defaults to an empty string.

4. `hideQuickAssistant`: Hide the Quick Assistant panel.

   - No arguments.

5. `toggleQuickAssistant`: Toggle the visibility of the Quick Assistant panel.

   - Same arguments as `showQuickAssistant`.

## Examples

### Show the Cherry Studio App

```bash
curl -X POST http://localhost:9090 -d '{"cmd": "showApplication"}'
```

### Translate Some Text in Quick Assistant

```bash
curl -X POST http://localhost:9090 -d '{
  "cmd": "showQuickAssistant",
  "route": "translate",
  "clipboardText": "Hello, world!"
}'
```

### Pre-fill Some Input Text in Quick Assistant

```bash
curl -X POST http://localhost:9090 -d '{
  "cmd": "showQuickAssistant",
  "route": "home",
  "userInputText": "This is a pre-filled text"
}'
```

### Summarize Copied Text in Quick Assistant

Require `jq` and `wl-clipboard` to be installed.

```bash
#!/bin/bash

# Check if clipboard content is text
if ! wl-paste -l | grep -q 'text/plain'; then
    echo "Clipboard content is not text."
    exit 1
fi

# Escape the clipboard text to a JSON string
clipboardText=$(wl-paste -n | jq -Rs .)

curl -X POST http://localhost:9090 -d '{
  "cmd": "showQuickAssistant",
  "route": "translate",
  "clipboardText": '"$clipboardText"'
}'
```

## Troubleshooting

If you encounter any issues with the external control feature, please check the logs of the Cherry Studio app for any error messages or warnings with a tag `[ExternalControl]`.

If you need further assistance, feel free to open an issue.
