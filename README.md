# Wishlist

A wish list app that helps you save up for the things you want, and lets you share the list with friends and family.

No build step, no dependencies, no account, and it works offline. Open `index.html` in a browser and start adding wishes.

## Features

- **Savings at a glance**: the blue card shows how much you've saved towards your open wishes, out of their total price
- **Add money** to any wish. When a wish is fully saved, you get a little celebration.
- **Weekly plan**: pick €10, €20 or €40 a week for a wish and see "ready in 7 wk" (a planning aid only; no money moves)
- **Wish details**: big icon or photo, want level, price, notes, a link with **Buy it now**, and status (Wanted, Reserved, Got it)
- **Multiple lists**, each with its own icon and currency
- **Search** your wishes
- **Share links**: a read-only snapshot of a list is encoded in the URL, so no server is needed. Friends can tap *I'll get it* to keep track of what they're buying. Their picks stay on their own device. Your savings and "Got it" items are never shared.
- **Undo** for deleted wishes, **backup** export and import as JSON
- **Dark mode** that follows your system, with a switch in Settings
- **Phone-first**: bottom tab bar, bottom sheets and a push-in detail screen. On wide screens the list and the details sit side by side.
- Keyboard shortcuts: `n` new wish, `/` search, `Esc` back

## Running it

```sh
# any static server works, or just double-click index.html
python3 -m http.server 8000
# → http://localhost:8000
```

To publish it, push the folder to GitHub Pages, Netlify or any static host.

## How data is stored

Everything is saved in your browser's `localStorage`, so it never leaves your device. Use **Settings → Export backup** to move your lists to another browser or device.

## Files

| File         | What it does                                        |
| ------------ | --------------------------------------------------- |
| `index.html` | Screens, sheets and the SVG icon set                |
| `styles.css` | Design tokens, light/dark themes, responsive layout |
| `app.js`     | State, rendering, savings, sharing, import/export   |
| `fonts/`     | Self-hosted Archivo and Manrope (SIL OFL)           |

## Design

White and blue: one saturated blue (`#1f5bff`), deep navy ink and soft blue-grey surfaces. Headings and amounts use Archivo at its widest, heaviest setting; the interface uses Manrope. Each wish gets a line icon picked from its name and category (Lucide-derived, ISC), or its own photo. Motion uses strong ease-out curves, plays only when something new appears, and respects reduced-motion.
