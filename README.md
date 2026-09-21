# AI Clock: GitHub source + Cloudflare hosting

A small public clock endpoint for AI readers and browsers. The code lives on GitHub; Cloudflare executes it on each HTTP request. There is no file rewritten every second and no scheduled job.

This is the time-only version, separate from Live Context Gateway. It does not supply live sports, weather, or device location. It does not connect to, authenticate with, or add tools to Proton Lumo.

## What it returns

The default timezone is `America/New_York`. A snapshot includes UTC generation time, local calendar date, weekday, local time, UTC offset, yesterday/tomorrow calendar dates, a deployment verification code, and a per-request random ID.

`clock_verification` explicitly says that the hosting runtime clock has not been independently checked against a time authority. `timezone_source` identifies a setting, not device geolocation.

| Route | Output |
| --- | --- |
| `/` | Server-rendered HTML; no client-side JavaScript required |
| `/time` | Plain text for AI readers |
| `/time.json` | JSON |
| `?tz=America%2FNew_York` | Explicit timezone; optional because this is the default |
| `?tz=UTC` | UTC timezone |
| `?format=text`, `?format=html`, `?format=json` | Override the default output format |

Live responses include no-store cache headers and `X-Robots-Tag: noindex, noarchive`. They are designed for direct retrieval, not search-index clock snippets. Headers cannot force an AI platform to discard its own cached/indexed copy or invoke a tool.

## Browser-only setup

### 1. Extract the package

Download and extract the ZIP. The deployment needs these three files at the repository root:

```
worker.js
wrangler.jsonc
package.json
```

The README, prompt, tests, and test report are useful but are not part of the runtime. Upload the extracted files, not the ZIP itself and not an extra enclosing folder.

### 2. Create the GitHub repository

1. Sign in at https://github.com and open https://github.com/new.
2. Name the repository `ai-clock`.
3. Select Public to share the source. A private repository can also be connected to Cloudflare; public hosting does not require public source.
4. Leave the initialization options blank and create the repository.
5. On the empty repository page, choose **uploading an existing file**. For an initialized repository, use **Add file > Upload files**.
6. Select the extracted files and commit them to your production branch, normally `main`.
7. Confirm `worker.js`, `wrangler.jsonc`, and `package.json` are visible directly on the repository's main page.

Do not enable GitHub Pages. GitHub stores the source; it is not this endpoint's execution host.

GitHub documentation:
- https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

### 3. Connect the repository to Cloudflare Workers

1. Sign in or create an account at https://dash.cloudflare.com.
2. Open **Workers & Pages > Create application**.
3. Choose **Get started** beside **Import a repository**. Use the Workers import flow, not a Pages/static-site project.
4. Choose GitHub and authorize **Cloudflare Workers and Pages**. Restrict repository access to `ai-clock` instead of granting all repositories.
5. Select the `ai-clock` repository.
6. Use these settings:

| Setting | Value |
| --- | --- |
| Worker/project name | `ai-clock` |
| Production branch | `main`, or the actual branch containing your uploaded files |
| Root directory | Repository root; leave the default when files are at the top level |
| Build command | Leave blank |
| Deploy command | `npx wrangler deploy` |
| Runtime variables, bindings, databases | None |

The Worker name must match `name` in `wrangler.jsonc`. This project has no frontend build or output directory. Cloudflare runs the deployment tools; you do not need Node.js, Git, or a terminal on your own computer for these steps.

Select **Save and Deploy**. Check the build/deployment status and address any reported errors. Do not give Lumo a deployment-preview address: use the production `workers.dev` address.

Cloudflare documentation:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/

### 4. Open the production endpoint

Cloudflare assigns a production address with this shape:

```
https://ai-clock.YOUR-SUBDOMAIN.workers.dev
```

Use the exact URL shown in your dashboard, not the literal example. A custom domain is unnecessary for this setup. The production route is enabled in `wrangler.jsonc` with `workers_dev: true`; deployment previews are disabled.

Open `/` to view HTML, `/time` for plain text, or `/time.json` for JSON. Refresh a few seconds apart. `generated_at_utc` and the request ID should change. `verification_code` should stay the same until you change the code and redeploy.

The page does not visibly tick by itself: it is a snapshot generated on request. This is intentional. No browser-side clock, automatic polling, or repeated GitHub commit is necessary for a fresh lookup.

Cloudflare URL documentation:
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

### 5. Configure Lumo

Open Lumo in a browser at https://lumo.proton.me and enable web search for your test conversation. Proton documents Custom Lumos as available on the web app.

For an existing Custom Lumo, use **Tools > Custom Lumos > Edit**. Otherwise use **Tools > Custom Lumos > + Create** and give it a name such as `Live Context`.

Paste the contents of `LUMO-INSTRUCTIONS.txt` into its instructions, replacing `YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` with your actual production hostname. Save the instructions. Do not upload a saved clock response as a knowledge file and expect it to remain current.

Official Proton documentation:
- https://proton.me/support/lumo-getting-started
- https://proton.me/support/custom-lumos

These are behavioral instructions, not an API integration. They cannot make Lumo invoke a tool that is unavailable or force a fresh retrieval. Test the actual behavior next.

### 6. Test actual retrieval

Ask Lumo, replacing the example URL:

```
Retrieve this exact live URL now:
https://ai-clock.YOUR-SUBDOMAIN.workers.dev/time

Report generated_at_utc, local_datetime, weekday, and verification_code
exactly as returned. Do not use a search snippet or an earlier response.
If you cannot retrieve it, say so.
```

Compare the verification code with your page. Then perform the stronger same-URL check:

1. On GitHub, open `worker.js` and click Edit (the pencil).
2. Change the value of `VERIFICATION_CODE` near the top to a new random string you choose. Keep the quotes. Do not tell Lumo the new value.
3. Commit the edit to the connected production branch. Cloudflare's Git integration should trigger a new deployment.
4. Confirm the deployment succeeded and your browser shows the new code.
5. Ask Lumo to retrieve the same URL again, preferably in a fresh conversation using the same Custom Lumo.
6. Check whether it returns the new code and a plausible current generation time.

A new hidden-from-the-prompt code supports fresh retrieval in that test. It is not proof that every future question triggers a lookup or that every timestamp will be correct. A repository is public too, so a marker alone does not cryptographically prove the exact retrieval path. Compare the returned time as well.

Do not compare your browser's `request_id` with Lumo's: separate requests should have different IDs. `verification_code` is a public test marker, never a password.

## Cost, access, and privacy

As checked September 20, 2026, Cloudflare Workers Free includes 100,000 requests per day across the account and other limits, including CPU limits. Public traffic consumes that allowance. Keep the Free plan for this small experiment; do not add paid resources or upgrade accidentally.

Pricing: https://developers.cloudflare.com/workers/platform/pricing/

The script has no application logging, no database, no API keys, no upstream fetch, no arbitrary-URL proxy, and no use of requester IP geolocation. Cloudflare still handles HTTP requests and may process operational request metadata under its own service policies. A timezone in a URL is public request data.

Leave the clock publicly readable for an ordinary unauthenticated AI fetch. Adding a sign-in requirement would require a compatible authenticated integration. Do not put precise locations, passwords, API tokens, or chat history in the repository or query string.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing entry point or config | Put the three required files at repository root; use that root in Cloudflare. |
| Worker name mismatch | The dashboard name and `wrangler.jsonc` must both be `ai-clock`. |
| Asked for a static build output folder | You may have selected Pages rather than the Workers repository-import flow. |
| Invalid timezone (400) | Use a supported timezone such as `America/New_York` or `UTC`, with correct URL encoding. |
| Old code after a commit | Check whether the commit is on the connected production branch and whether the deployment succeeded. |
| Page works but Lumo cannot read it | Enable web search, try the exact `/time` URL or HTML root, and run the marker test. Copying a fresh text snapshot remains the manual fallback. |
| Lumo repeats the old verification code | Its retrieval may be cached or absent. Do not treat its answer as a verified live lookup. |
