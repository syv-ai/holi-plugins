# holi-plugins

Syv.ai's community plugins for [Holi](https://github.com/syv-ai/holi), several in one repository.

## Layout

Each plugin is a top-level folder named after its id, with its `holi-plugin.json` inside:

```
holi-plugins/
├─ notes/
│  ├─ holi-plugin.json   { "id": "notes", "name": "Notes", "version": "0.1.0", "apps": ["Notes.app"] }
│  └─ Notes.app/
└─ <next-plugin>/
   ├─ holi-plugin.json
   └─ ...
```

- **The folder name is the plugin's id.** Holi refuses a folder whose manifest names another id.
- **Everything is relative to the plugin's folder:** `apps`, `skills`, `setup` and `serve`. The
  folder is the commands' working directory, and a link out of it, to a sibling plugin too, is
  refused.
- The manifest's grammar is in Holi's
  [community plugins page](https://github.com/syv-ai/holi/blob/main/docs/features/community-plugins.md).

## Releases

Each plugin is released on its own, with a tag `<id>-v<version>` whose manifest says that version:

```sh
git tag notes-v0.1.0
git push origin notes-v0.1.0
```

Holi offers an update when a plugin's own newest tag is newer than what a machine has. A tag for one
plugin is never an update for another.

## Trying a plugin before releasing it

In Holi, open Settings, Plugins, and use **Use a folder…** to pick the plugin's folder in your
checkout. It runs in place, with no release, consent or pin.

## Installing

Search for `syv-ai/holi-plugins` in Settings, Plugins. Each plugin here is its own row.
