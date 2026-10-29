# VibeFix: get what breaks fixed, starting with a free check after each deploy

Our AI agent fixes what breaks in your live app, on request. This Action only runs the free check after each deploy.

We check for free and fix for money. Login, emails, payments, APIs, integrations, front end or back end: our AI agent finds the cause, fixes it in your code and re-checks your live app.

This Action runs the free check after each deploy: an AI agent signs up to your live app like a brand-new user, with a real inbox, and reports on the pull request whether a new user can get in.

```
### VibeFix sign-up check: `your-app.example.com`

**Can a new user sign up? No: a new user could not finish signing up.**

**1 problem a new user would hit:**
1. New users can't create an account: the confirmation email never arrived

[Result →](…) · tested `a1b2c3d`
```

The check is free. A paid fix is available on [vibe-fixer.com](https://vibe-fixer.com/?src=gh-action).

## Use it

`.github/workflows/vibefix.yml`:

```yaml
name: VibeFix sign-up check
on: deployment_status
permissions:
  id-token: write        # proves which repo this runs in; no API key needed
  pull-requests: write   # to post the result on the pull request
  contents: read
jobs:
  signup-check:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: yos88da/vibefix-signup-check@v1
```

On a public repo, Vercel reports deployments to GitHub, so this workflow works as it is. A private repo also needs the site marker (see [Only apps your repo points to](#only-apps-your-repo-points-to)).

If your host doesn't report deployments to GitHub (Netlify, for example, may not), run it on `push`, give the address, and add the site marker described below:

```yaml
name: VibeFix sign-up check
on:
  push:
    branches: [main]
permissions:
  id-token: write
  pull-requests: write
  contents: read
jobs:
  signup-check:
    runs-on: ubuntu-latest
    steps:
      - uses: yos88da/vibefix-signup-check@v1
        with:
          url: https://your-app.example.com
```

### Inputs

| Input | Default | |
|---|---|---|
| `url` | the deployment's address | The public https address of your live app |
| `fail-on-broken` | `false` | Fail the job when a new user cannot sign up |
| `comment` | `true` | Post the result on the pull request, or on the commit when there is no pull request |

### Outputs

`signup` (`yes`, `no`, `none` or `unknown`), `problem-count`, `result-url`.

## Only apps your repo points to

The address must be one your repo itself names. It qualifies when:

- on a **public** repo, it is the address of a deployment your hosting integration (for example Vercel) reported to GitHub, or
- on **any** repo, public or private, the site names the repo itself: it serves `/.well-known/vibefix-repo` containing `owner/repo`, or has `<meta name="vibefix-repo" content="owner/repo">` on the page.

Any other address is refused, and nothing is checked.

## What to expect

- **A test user:** each check really signs up, so it creates a test user in your app, with an address from our test inbox.
- **Time:** usually a few minutes, up to 20.
- **Limits:** one check per repo per day and three per account per day (UTC). A shared daily and monthly allowance also applies.
- **When it can't run:** if a limit is reached or our service is down, the step passes with a note. It fails only if the workflow is set up wrong (no `id-token: write`, no address), or if you set `fail-on-broken: true` and a new user can't sign up.
- **What's posted:** whether a new user can sign up, how many problems a new user would hit, and their titles, with a link to the result. On a public repo, findings that could expose your users' data are counted but not described, and no screenshot is posted. On a private repo, the result links a screenshot when one was taken.
- **Links:** the result and screenshot links are unguessable public links.
- **Protected previews:** previews behind a login (for example, Vercel deployment protection) can't be checked. Use the public address.

[Privacy](https://vibe-fixer.com/privacy) · [Terms](https://vibe-fixer.com/terms) · [help@vibe-fixer.com](mailto:help@vibe-fixer.com)
