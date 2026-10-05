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

`src/lib/stories/source.ts` is the only module that knows where a clip lives. The shelf and the player ask it for a playable URL.

## Run it

```bash
npm install
npm run dev
```

The dev server listens on port 8080. `npm run typecheck` checks types. `npm run build` makes a production build.
