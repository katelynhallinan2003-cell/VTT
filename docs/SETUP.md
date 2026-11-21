# Setup guide

This takes about 20 minutes, once. Everything is free. You will set up four things:

1. **GitHub Pages** hosts the app (a static website).
2. **Firebase** (free plan) handles live sync, Google sign-in for you, and saved libraries.
3. **imgbb** (free) hosts your map and token images.
4. **A list of Google accounts allowed to be a DM** (just you, to start).

Players need nothing: they open your link, type a name, and play.

> **Try it first without any setup.** Run `npm install && npm run dev`, open the printed address with `?demo` on the end
> (e.g. `http://localhost:5173/?demo`). Demo mode stores everything in your browser and lets two tabs act as DM and player.

---

## 1. Put the code on GitHub

1. Create a **public** repository (GitHub Pages is free for public repos), e.g. `vtt`.
2. Push this project to the `main` branch.
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

The included workflow (`.github/workflows/deploy.yml`) tests, builds and publishes the site on every push to `main`.
Your site will be at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

## 2. Create the Firebase project

1. Go to <https://console.firebase.google.com> and **Add project**. Name it anything. You can turn Google Analytics off.
2. **Build → Authentication → Get started → Sign-in method**, then enable two providers:
   - **Google** (choose a support email, Save). This is how you sign in as DM.
   - **Anonymous** (Enable, Save). This is how players join without accounts.
3. **Authentication → Settings → Authorized domains → Add domain**: add `YOUR-USERNAME.github.io`.
   (`localhost` is already there for local testing.)
4. **Build → Realtime Database → Create database.** Pick a region near you and choose **Start in locked mode**.
   Copy the database URL shown at the top (like `https://your-project-default-rtdb.firebaseio.com`).
5. **Rules tab**: delete everything, paste the entire contents of `database.rules.json` from this repo, and click **Publish**.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)**: register an app (any nickname, skip Firebase Hosting).
   You'll see a `firebaseConfig` block.
7. Open `public/config.json` in this repo and fill in `apiKey`, `authDomain`, `databaseURL`, `projectId` and `appId` from that block.
   Commit and push. (These values are meant to be public. The security comes from the rules in step 5.)

## 3. Say who is allowed to be a DM

Only Google accounts on this list can create tables. Everyone else (your players) can only join.

The easiest way is to import a tiny file while the database is still empty:

1. Copy `docs/seed.example.json`, put **your Gmail address** in it, and **replace every `.` in the address with a `,`**
   (Firebase keys can't contain dots). `jane.doe@gmail.com` becomes `jane,doe@gmail,com`.
2. **Realtime Database → Data tab → ⋮ menu → Import JSON** and choose the file.

You should now see `config → allowedEmails → jane,doe@gmail,com: true`.
To let a friend DM too, add their address the same way (hover `allowedEmails`, click **+**, name = their address with commas, value = `true`).
You can do this any time. It takes effect immediately.

## 4. imgbb (image hosting)

1. Make an account at <https://imgbb.com> and get an API key at <https://api.imgbb.com>.
   Use an account you only use for this, because the key is shared with your players (see Security notes).
2. You'll paste the key into the app in the next step. Don't put it in the repo.

## 5. First run

1. Open your site, click **DM: sign in with Google**, and sign in with the allowlisted account.
   (If it says your email isn't on the allowlist, check the comma-ified address in step 3.)
2. **Create table**, then open **Settings → Image uploads**, paste the imgbb key, **Save**, then **Test upload**.
   The test uploads a tiny image and checks the browser can use it on the board. Both lines should say OK.
3. **+ New scene**, upload a map, then set the grid (see below).
4. **Copy player link** and send it to your friends.

### Setting the grid

- Press **G** (or "Draw a box to set the grid"), drag a box over the squares of your map, and say how many squares it covers.
  Covering many squares (say 10 by 10) is more accurate than covering one.
- Fine-tune with the **Square size** and **Offset** sliders. Turn the grid off from the same panel.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The app says "Demo mode" | `public/config.json` still has the `PASTE_…` placeholders, or wasn't committed. |
| Google sign-in popup says `auth/unauthorized-domain` | Add `YOUR-USERNAME.github.io` under Authentication → Settings → Authorized domains. |
| "Could not sign you in" for players | Enable the **Anonymous** provider (step 2). |
| "is not on the DM allowlist" | The email key must be lowercase with dots replaced by commas, value `true` (a boolean, not a string). |
| "Could not create the table: permission_denied" | Rules weren't published (step 2.5), or the allowlist entry is missing. |
| Upload test says CORS problem | imgbb's image host didn't allow the browser to use the image as a texture. Tell me and I'll add another image host option. |
| Players see nothing / "Waiting for the DM" | The scene isn't live. Use **Show to players** next to the scene picker. |
| A map looks blurry when zoomed in | The GPU limit is applied to very large maps (over 8192 px on a side). It is downscaled for display only. The original is untouched. |

## Security notes (read once)

- **Who can DM:** enforced by the database rules, not just the page. Strangers who find your site can't create tables.
- **Who can join:** anyone with the table link. The link contains a long random id. Treat it like a password.
- **What players can't read:** other (non-live) scenes, hidden tokens, and the scene list. The database refuses these reads.
- **What players could technically see:** image URLs of the live map (fog hides the picture on screen, not in the browser's network tab),
  and the shared imgbb key. This is fine for a table of friends. It would not be fine for a public game.
- **Permission toggles:** token move / create / delete / claim and pings are enforced by the database rules. The other toggles are enforced by the app.

## Updating

Pull new code, push to `main`, and GitHub redeploys. If a release changes `database.rules.json`, re-paste it into the Rules tab
(regenerate it with `npm run rules`, which writes it from `scripts/build-rules.mjs`).
