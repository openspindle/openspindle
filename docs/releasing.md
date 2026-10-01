# Releasing

`npm run dist:mac` builds `release/OpenSpindle-<version>-universal.dmg`, and the `-universal-mac.zip` that installed apps update from: one app for Apple silicon and Intel, signed with a Developer ID Application certificate, notarized by Apple and stapled, so it opens on any Mac without a Gatekeeper warning. `npm run package:mac` is the quick build for this Mac only: an ad-hoc signed `release/mac*/OpenSpindle.app`, not notarized.

Packaged apps keep only Electron's English resources (`electronLanguages` in [electron-builder.yml](../electron-builder.yml)), as the interface is English: without Chromium's other translations the app is 50 MB smaller, and on every Mac, whatever its language, Chromium's locale is en-US (times and numbers the app formats with the default locale look as they do in the US) and macOS's own dialogs are in English.

## Versions

Versions follow semantic versioning. [release-please](https://github.com/googleapis/release-please) sets the next one from the titles of the pull requests merged since the last release ([Pull requests](../README.md#pull-requests)): a `fix` or `perf` raises the patch version, a `feat` the minor version, and a breaking change (`feat!:`) the minor version while the version is below 1.0.0 and the major version after. The release pull request writes it into package.json, package-lock.json and `.release-please-manifest.json`; nobody edits it by hand. To release a particular version, such as 1.0.0, end a pull request's description with the line `Release-As: 1.0.0`, and the release pull request takes that version. A release pull request opens only when there is something for the release notes: a `feat`, `fix`, `perf` or `revert` merged since the last release.

A release from GitHub Actions takes the release workflow's run number as its build number (`CFBundleVersion`), which grows from one release to the next; local builds use the version as their build number. The About panel shows both, as in "Version 0.2.0 (57)"; dev and preview runs show package.json's version as "(dev)".

## Credits

The About panel credits the open-source software the app includes, with the license texts. Every production build (`npm run build`, `start`, `package:mac` and `dist:mac`) records the npm packages each bundle contains, their licenses and copyright notices in `build/third-party-notices.json` ([tools/vite/third-party.ts](../tools/vite/third-party.ts)), together with Electron and the stylesheets Tailwind compiles in; commit the file when it changes, as dev runs read it. Packaged apps carry it in `Contents/Resources`, with Electron's license and `LICENSES.chromium.txt` for the Chromium, Node.js and other software Electron includes. electron-builder writes that file after packing ([tools/packaging/chromium-licenses.ts](../tools/packaging/chromium-licenses.ts)) from Electron's `LICENSES.chromium.html`, which repeats the same license texts for hundreds of components: every component keeps its homepage, copyright notices and license, and a passage that recurs is printed once and cited as `[Text N]`, 1.5 MB instead of 20 MB. The build fails if any component's text could not be rebuilt from the file. Both license files come with Electron's binary, which the electron package downloads only when something first runs it, not on `npm ci`: `package:mac` and `dist:mac` download it first when it is missing. A package whose license files lack its copyright notice gets one in the tool's `ATTRIBUTIONS`, as occt-import-js does; a package that publishes no license text at all gets the standard text of the license its package.json names, in `LICENSE_TEXTS`, as lazy-val (electron-updater's) does.

## Releases from GitHub Actions

`main` is the trunk: every change reaches it as a squash-merged pull request that passed CI, and every release is cut from it. [ci.yml](../.github/workflows/ci.yml) runs `npm ci`, the typecheck, lint, Prettier check and build on every pull request and every push to `main`, and fails when the build changes the committed `build/third-party-notices.json`; [pr-title.yml](../.github/workflows/pr-title.yml) checks that a pull request's title is a Conventional Commit. On release pull requests CI also packages the app on a macOS runner, so a packaging problem shows before the release is tagged, and keeps the build for testers ([Trying the next release](#trying-the-next-release)).

Every push to `main` runs [release.yml](../.github/workflows/release.yml):

1. release-please keeps a release pull request open, titled `chore(main): release <version>`. It raises the version and adds the release's section to CHANGELOG.md, and every merge to `main` updates it. It changes nothing else, so it can stay open until you want a release.
2. Merging it releases. release-please tags the merge commit `v<version>` and creates a draft GitHub release whose notes are the new CHANGELOG.md section ([release-please-config.json](../release-please-config.json)). The build job checks out that commit on a macOS runner, runs `npm ci` and `npm run dist:mac` with the build number above, checks that the app carries its notarization ticket and the update feed, attaches the DMG, the zip, their blockmaps and `latest-mac.yml` to the draft, and publishes it as the latest release, "OpenSpindle <version>".

Installed apps see a release only once it is published, with everything attached. When the build fails, the draft stays unpublished: if the cause lies outside the code (a secret, an Apple outage), fix it and **Re-run failed jobs**; if the code needs a change, delete the draft and its tag (`gh release delete v<version> --cleanup-tag`) and merge the fix, which the next release pull request releases under a new version. Runs of release.yml go one at a time, in push order; while one runs, only the newest waiting push is kept, and a merged release pull request whose run was dropped is released by the next run.

## Trying the next release

Every CI run on the release pull request builds the universal app from the pull request (`npm run package:mac -- --universal`) and links the zip from the run's summary for 14 days: the pull request's **Checks** tab → **CI** → **Summary**. Downloading it needs a GitHub account. It is the code merging would release, so testers can try it before it ships, but it is ad-hoc signed and not notarized:

- macOS blocks its first launch: open it once, then choose **Open Anyway** in System Settings → Privacy & Security.
- Quit an installed OpenSpindle first: the build uses the same data folder, and only one runs at a time.
- It does not update itself ([Updates](#updates)); install the release once it is published.

**Run workflow** on the CI workflow builds the same for any branch.

## Setting up the repository

Once, when the repository is created on GitHub (`OWNER/REPO` below), with the GitHub CLI and admin rights on the repository:

1. Squash merging only, with the pull request's title and description as the commit message, and merged branches deleted:

   ```sh
   gh repo edit OWNER/REPO --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
   gh api -X PATCH repos/OWNER/REPO -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
   ```

2. The ruleset protecting `main`, [.github/rulesets/main.json](../.github/rulesets/main.json): no force pushes or deletion, linear history, and changes only through squash-merged pull requests whose conversations are resolved and whose Checks and PR title checks pass. Repository admins can bypass it when merging a pull request, never by pushing. After a change to the file, `gh api -X PUT repos/OWNER/REPO/rulesets/<id> --input .github/rulesets/main.json` updates it (`gh api repos/OWNER/REPO/rulesets` lists the ids).

   ```sh
   gh api -X POST repos/OWNER/REPO/rulesets --input .github/rulesets/main.json
   ```

3. The release app. release-please opens its pull request with a GitHub App's token, because pull requests opened with a workflow's own token start no workflows, so they would never get the checks `main` requires. Under Settings → Developer settings → GitHub Apps (the organization's, if one owns the repository), create an app with its webhook turned off and two repository permissions, Contents and Pull requests, both Read and write. Install it on this repository only, generate a private key, and store the app's client ID and the key:

   ```sh
   gh variable set RELEASE_APP_CLIENT_ID --repo OWNER/REPO --body <client ID>
   gh secret set RELEASE_APP_PRIVATE_KEY --repo OWNER/REPO < <app name>.private-key.pem
   ```

4. The `release` environment, whose secrets only runs on `main` can read:

   ```sh
   gh api -X PUT repos/OWNER/REPO/environments/release -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
   gh api -X POST repos/OWNER/REPO/environments/release/deployment-branch-policies -f name=main -f type=branch
   ```

5. Immutable releases, so that nobody can change a published release's files or move its tag: `gh api -X PUT repos/OWNER/REPO/immutable-releases`.
6. Under Settings → Actions → General, **Require actions to be pinned to a full-length commit SHA**. The workflows pin every action, and Dependabot ([dependabot.yml](../.github/dependabot.yml)) proposes new pins and npm updates monthly.
7. Private vulnerability reporting, which [SECURITY.md](../SECURITY.md) points reporters to: `gh api -X PUT repos/OWNER/REPO/private-vulnerability-reporting`.

The `release` environment needs five secrets:

| Secret                     | Value                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `MAC_CERTIFICATE_P12`      | The Developer ID Application certificate and its private key, exported as `.p12`, base64-encoded |
| `MAC_CERTIFICATE_PASSWORD` | The password the `.p12` was exported with                                                        |
| `APPLE_API_KEY_P8`         | The App Store Connect API key file (`AuthKey_<key id>.p8`), as text                              |
| `APPLE_API_KEY_ID`         | That key's ID                                                                                    |
| `APPLE_API_ISSUER`         | The issuer ID shown above the list of keys                                                       |

To make them with the GitHub CLI:

1. In Keychain Access → login → My Certificates, right-click **Developer ID Application: …**, choose **Export**, save a `.p12` and give it a password. Then run `base64 -i DeveloperID.p12 | gh secret set MAC_CERTIFICATE_P12 --env release` and `gh secret set MAC_CERTIFICATE_PASSWORD --env release` (it asks for the password), and delete the `.p12`.
2. In App Store Connect → Users and Access → Integrations → App Store Connect API, add a team key with Developer access and download it (Apple offers the file once). Then run `gh secret set APPLE_API_KEY_P8 --env release < AuthKey_<key id>.p8`, `gh secret set APPLE_API_KEY_ID --env release --body <key id>` and `gh secret set APPLE_API_ISSUER --env release --body <issuer id>`.

Until the app and the secrets are set, the release workflow stops with an error naming this page. For private repositories, GitHub bills macOS runner minutes at a higher rate than Linux ones.

## Updates

Packaged apps update themselves from this repository's GitHub releases ([updates.ts](../electron/main/updates.ts), with electron-updater), so the repository has to be public: installed apps read its releases without credentials. When it builds the DMG and zip, electron-builder writes the feed, `latest-mac.yml`, beside them, and `app-update.yml`, which names the repository in package.json, into the app. `npm run package:mac` builds have no DMG or zip and so neither file: their apps cannot update and, like a dev run, say so under **Check for Updates…**.

An app checks ten seconds after launch and every four hours, downloads a newer release's zip in the background and installs it when it quits. A notification says when an update is ready; clicking it, or **Restart to Install Update…** in the OpenSpindle menu, shows the release notes with **Restart Now**, **Later** and **Release Notes** (the release's page). **Check for Updates…** checks at once and says what it found. Restarting asks the same questions as quitting (a running job, unsaved changes), so an update never interrupts a job; when declined, it installs at the next quit.

The release notes are the release's section of CHANGELOG.md: the titles of the `feat`, `fix`, `perf` and `revert` pull requests merged since the previous release, under Features, Bug Fixes, Performance and Reverts, so titles should read well to people using the app. The update dialog shows their first lines as text. macOS (Squirrel.Mac) accepts only an update signed by the same team, and replaces only an app that can be replaced: run from /Applications, not from the DMG.

## Releasing from a Mac

This needs the Developer ID Application certificate in the login keychain (only the team's Account Holder can create one: Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application) and a notarytool keychain profile, made once with `xcrun notarytool store-credentials openspindle-notary --apple-id <Apple ID> --team-id <team id>` and an app-specific password from account.apple.com.

Copy `.env.example` to `.env`, which git ignores, and set `CSC_NAME` to the certificate's name without "Developer ID Application: " and `APPLE_KEYCHAIN_PROFILE` to the profile. `npm run dist:mac` reads it; variables already set in the shell win. The first signing asks whether `codesign` may use the certificate's key: **Always Allow** saves a prompt per file. `spctl --assess -vv release/mac-universal/OpenSpindle.app` reports `source=Notarized Developer ID` for a good build.

## Error reports

Apps report errors to Sentry ([architecture.md](architecture.md#errors-and-logs)) when they were built with its DSN, `SENTRY_DSN`, which says where reports go and is not a secret. Every build takes it from the environment or `.env` (dev runs too: their reports say `development`, releases `production`), and a build without one reports nothing. Reports name the release `openspindle@<version>`.

Release builds also upload their source maps, so that reports show the source rather than the minified bundles, and then delete them: the app ships without them. That takes a Sentry auth token, `SENTRY_AUTH_TOKEN` (an organization token, from Sentry's Settings → Auth Tokens), with `SENTRY_ORG` and `SENTRY_PROJECT`, the organization's and the project's slugs. A build uploads only when the token is in its environment: `npm run dist:mac` reads it from `.env`, and `npm run build` and dev runs never upload. A failed upload does not stop the build; its reports show minified code.

The release workflow's build takes the DSN, the organization and the project from the repository's Actions variables, and the token from the `release` environment's secrets:

```sh
gh variable set SENTRY_DSN --repo OWNER/REPO --body <DSN>
gh variable set SENTRY_ORG --repo OWNER/REPO --body <organization slug>
gh variable set SENTRY_PROJECT --repo OWNER/REPO --body <project slug>
gh secret set SENTRY_AUTH_TOKEN --repo OWNER/REPO --env release
```

## What signing and notarization do

- Signing, on this Mac or the runner, proves the app comes from the certificate's team and has not changed since. The app runs with the hardened runtime and electron-builder's default entitlements: `allow-jit` and `allow-unsigned-executable-memory` for V8 and WebAssembly, and `disable-library-validation` as provided by Electron's default entitlements.
- Before signing, electron-builder flips Electron's fuses (`electronFuses` in [electron-builder.yml](../electron-builder.yml)), so the signature covers them. The packaged app loads only its own `app.asar` and checks it against the hash in its Info.plist, and it ignores `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect` and `SIGUSR1`: nobody can run their own Node.js code inside the signed app. `npx @electron/fuses read --app <path to OpenSpindle.app>` lists them. Development runs use Electron from node_modules, which keeps all of them.
- Notarization uploads a zip of the signed app to Apple's notary service, which checks it for malware and signing problems and issues a ticket for those exact files; electron-builder staples the ticket to the app, so Gatekeeper accepts it offline. It is automated, not App Review, and takes a few minutes. A signed app that is not notarized is blocked on other Macs like an unsigned one.
- The DMG itself is not signed (electron-builder's default): the stapled app inside it carries the notarization.
- Without a signing certificate the build fails (`forceCodeSigning`). Without notarization credentials electron-builder only warns and skips notarization, which the release job's check catches.
- electron-builder 26 keeps signing options directly under `mac` and takes `APPLE_API_KEY` as a file path; version 27 moves the options under `mac.sign` and takes the key's contents, base64-encoded.
