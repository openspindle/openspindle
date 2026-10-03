# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

OpenSpindle's Windows releases are to be signed through SignPath Foundation's program for open-source projects; until then they ship unsigned ([Signing on Windows](docs/releasing.md#signing-on-windows)). The Mac app is signed with the project's own Developer ID certificate and notarized by Apple, outside this policy.

## What is signed

Only what the [release workflow](.github/workflows/release.yml) builds from this repository's source, at a release tag on `main`: `OpenSpindle.exe` and the installer, `OpenSpindle-Setup-<version>.exe`. Nothing built elsewhere, from other source or by anyone else is signed. The libraries that come with Electron, beside `OpenSpindle.exe`, are Electron's.

## Team roles

- Committers and reviewers: [@dylanschoenmakers](https://github.com/dylanschoenmakers)
- Approvers: [@dylanschoenmakers](https://github.com/dylanschoenmakers)

Every change reaches `main` as a squash-merged pull request that passed CI, under the repository's [ruleset](.github/rulesets/main.json); a pull request from anyone else is merged only by a reviewer, after review. An approver approves every signing request in SignPath. Team members must use multi-factor authentication for GitHub and SignPath.

## Privacy

OpenSpindle sends information to other computers only as follows:

- **Error reports** go to [Sentry](https://sentry.io/privacy/) when something goes wrong: automatically, until **Settings › Privacy › Send error reports automatically** is turned off, and from then on only the reports the user sends from the error dialog. They hold the error, the app's and the system's versions and the log's last lines, and no user name, IP address or host name. Feedback, which only the user sends, goes there too, with what the user attaches.
- **Update checks** ask this repository's releases on [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) for a newer version ten seconds after launch and every four hours, and download it when there is one.
- **The machine:** OpenSpindle listens for CNC machines' announcements on the local network and talks to the machine the user connects to, and to its camera.
- **Fusion 360:** the add-in and OpenSpindle talk only on the same computer.

Links in the app open in the browser, and only when the user follows them.
