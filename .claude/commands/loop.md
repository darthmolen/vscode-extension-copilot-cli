---
description: Create or update a cron job that runs Copilot on a repeating interval
argument-hint: <interval[m|h]> <instructions> <name>
---

Parse `$ARGUMENTS` and set up (or remove) a repeating cron job that invokes Copilot.

## Parsing rules

- **Single token** → cancel mode: the token is `<name>`. Remove the cron entry tagged `# copilot-loop-<name>` and print a confirmation.
- **Three or more tokens** → create/update mode: first token = `<interval>`, last token = `<name>`, everything in between = `<instructions>`.

## Validation

- Only `m` (minutes) and `h` (hours) suffixes are accepted.
- Reject `s` (seconds) with: `Error: interval unit 's' is not supported. Use 'm' (minutes) or 'h' (hours).`
- Minimum interval is 1 minute.

## Interval → cron schedule conversion

| interval | cron schedule        |
|----------|----------------------|
| `1m`     | `* * * * *`          |
| `5m`     | `*/5 * * * *`        |
| `15m`    | `*/15 * * * *`       |
| `30m`    | `*/30 * * * *`       |
| `1h`     | `0 * * * *`          |
| `2h`     | `0 */2 * * *`        |
| `Nh`     | `0 */N * * *`        |

For minutes: `*/N * * * *`. For hours: `0 */N * * *` (run at minute 0 of every Nth hour).

## Create/update steps

1. Resolve the copilot binary:
   ```bash
   COPILOT=$(which copilot)
   ```

2. Ensure the log directory exists:
   ```bash
   mkdir -p ~/.copilot/logs
   ```

3. Build the cron line:
   ```
   <schedule> $COPILOT -p "<instructions>" --allow-all-tools --no-ask-user >> ~/.copilot/logs/loop-<name>.log 2>&1 # copilot-loop-<name>
   ```

4. Install idempotently (removes any existing entry with the same name first):
   ```bash
   (crontab -l 2>/dev/null | grep -v "# copilot-loop-<name>"; echo "<cron line>") | crontab -
   ```

5. Print confirmation:
   ```
   ✓ Cron job created: <name>
     Schedule : <cron expr>  (every X minutes/hours)
     Command  : copilot -p "<instructions>" --allow-all-tools --no-ask-user
     Logs     : ~/.copilot/logs/loop-<name>.log
     Remove   : /loop <name>
   ```

## Cancel steps

1. Remove the tagged cron entry:
   ```bash
   (crontab -l 2>/dev/null | grep -v "# copilot-loop-<name>") | crontab -
   ```

2. Print confirmation:
   ```
   ✓ Cron job removed: <name>
   ```
