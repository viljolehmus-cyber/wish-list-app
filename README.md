# ✦ Wishful

A simple wish list app. Keep track of what you want, see what you've got, and share a list with friends and family.

No build step, no dependencies, no account. Open `index.html` in a browser and start adding wishes.

## Features

- **Multiple lists**, such as Birthday, Holidays or Home, each with its own icon and currency
- **Rich wishes**: title, link, price, category, priority (🔥 Must have · 💛 Would love · 🌱 Nice to have), image and notes
- **Status tracking**: click a card's status to cycle *Wanted → Reserved → Got it* (with a little celebration 🎉)
- **At-a-glance stats**: open wishes, the cost of what's left, reserved items and progress
- **Search, filter and sort** by priority, date, price or name
- **Share links**: a read-only snapshot of a list is encoded in the URL, so no server is needed. Friends can tap *I'll get this* to keep track of what they're buying. Their picks are saved on their own device, and "Got it" items are never shared.
- **Undo** for deleted wishes
- **Backup**: export and import all your lists as JSON
- **Dark mode** that follows your system, with a manual toggle
- **Works on phones**, with keyboard shortcuts (`n` new wish, `/` search) and reduced-motion support

## Running it

```sh
# any static server works, or just double-click index.html
python3 -m http.server 8000
# → http://localhost:8000
```

To publish it, push the folder to GitHub Pages, Netlify or any static host.

## How data is stored

Everything is saved in your browser's `localStorage`, so it never leaves your device. Use **⋮ → Export backup** to move your lists to another browser or device.

## Files

| File         | What it does                                       |
| ------------ | -------------------------------------------------- |
| `index.html` | Page structure and dialogs                         |
| `styles.css` | Design tokens, light/dark themes, responsive layout |
| `app.js`     | State, rendering, sharing, import/export           |
