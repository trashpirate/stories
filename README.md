# Stories

A private family shelf for video stories. One phone, no accounts. Clips stay on the device.

## What it does

- Add clips from the camera or gallery, put them in order, and give the story a title.
- Pick the cover from any clip. Drag and pinch the frame so the card shows the part you want.
- New stories start as presents. The first tap unwraps one, then it stays a normal card.
- Play a story full screen. Buttons hide until you tap. Pause, seek, go back to the shelf, or fill the screen.
- Kids mode hides the length, the new-story button, and delete. A slider sets the longest story kids can see.
- Outside Kids mode, a story can be edited the same way it was made.

## Where things live

The app copies each clip into the browser’s private file storage. IndexedDB keeps the title, cover, length, unwrap state, and the ordered list of clip paths. The gallery originals are left alone.

`src/lib/stories/source.ts` is the only module that knows where a clip lives. The shelf and the player ask it for a playable URL. A clip on this phone plays from the phone. If it is only in the private bucket, that module asks for a short-lived link.

## Private cloud

Clips and the shelf list can also live in a private Cloudflare R2 bucket. Nothing in the bucket is public. The app link still only opens a locked shelf. A family passphrase, kept on the server, is required before a story can be listed or played. Video links expire after two hours and are never stored in the app.

You do not need a separate database. The shelf list is one private object in the same bucket.

Set these on the server that hosts the app. Do not put them in the browser or in git.

```
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
FAMILY_PASSPHRASE=
```

Create an R2 API token that can read and write objects in that bucket only. Leave the bucket private: no public access, and no `r2.dev` website. Add one CORS rule for the app's address, methods `GET`, `PUT`, and `HEAD`, and allowed headers `*`. A token that cannot edit CORS is fine once that rule is saved. An origin of `*` is accepted too.

Until those values are set, stories stay on the phone and the shelf says so.


## Run it

```bash
npm install
npm run dev
```

The dev server listens on port 8080. `npm run typecheck` checks types. `npm run build` makes a production build.
