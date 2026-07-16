# CPA-Hosted Panel Compatibility Mode

This mode is for existing CPA environments that still open the panel from the CPA port. For new deployments, use Full Docker or native Manager Server first; those modes let CPAMP host the panel and provide full historical monitoring, model prices, import/export, and server-side inspection.

## Differences From Full Docker Mode

| Mode | Panel host | Login credential | Use case |
|---|---|---|---|
| Full Docker | Manager Server `:18317` | `cpamp_...` admin key | Recommended for new deployments. |
| CPA-hosted panel | CPA `:8317` | CPA Management Key | Keep an existing CPA-port workflow. |
| Frontend development | Vite dev server or static HTML | Browser-local CPA URL and key | Local development and debugging. |

## Notes

- The CPA-hosted panel uses the CPA Management Key for login. It does not require the CPAMP Admin Key.
- The CPA Management Key stays in the browser, matching CPA-hosted panel access.
- Manager Server mode manages the CPA connection server-side: setup/panel-saved connections are encrypted into SQLite, while installer env/secret mode reads the key from the install directory.
- The panel entry is the same, but available data depends on the hosting mode. Full historical monitoring, model prices, and server-side inspection come from Manager Server mode.

## When To Use It

Only consider the CPA-hosted panel when:

- Users are already used to opening the management panel from the CPA port.
- You do not want users to access the Manager Server panel port directly.
- You want the CPA Management Key to remain the panel access credential.

Prefer Full Docker or native Manager Server when:

- You want CPAMP to host itself independently.
- You want Manager Server to store configuration centrally.
- You need an admin key and a server-side managed CPA connection.
