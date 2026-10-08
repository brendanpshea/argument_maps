# argument_maps

A web app for practicing argument maps: premises, conclusions, linked vs.
convergent support, objections, and rebuttals. Students read a passage, build
a map, check it against a model answer, and get feedback. Everything runs in
the browser, with no server.

## What students do

1. **Add claims** from the passage. Depending on the lesson, they either click
   numbered claims or select the claim text themselves.
2. **Reword** claims on the map so each one is clear on its own (double-click
   a claim). When they check their work, their wording is shown next to the
   model wording. Wording isn't scored.
3. **Mark the main conclusion** (★) and **draw links**: drag from the dot on
   top of a premise to the dot under the claim it supports or objects to.
   Drag another premise onto an existing link's label to make a linked
   argument. Click a link's label to switch it between *supports* and
   *objects to*. An objection to an objection is shown as *rebuts*.
4. **Check my map** grades the map (partial credit for linked/convergent
   mix-ups) and gives hints without giving the answer away. **Show model
   answer** reveals it.
5. Multi-step lessons add new text (evidence, objections, replies) at each
   step. Students carry their map forward or start from the model answer.

Students can also use an **outline view** to do everything with the keyboard,
**download** their map as a PNG or as a map file they can load again later,
and pick up where they left off (work is saved in the browser).

## Writing lessons

Lessons are YAML files in [`lessons/`](lessons/). See
[`lessons/README.md`](lessons/README.md) for the format.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # grader tests + validates every lesson file
npm run build      # typecheck + production build into dist/
```

Pushing to `main` runs the tests, builds, and deploys to GitHub Pages
(`.github/workflows/deploy.yml`). In the repo settings, set
**Pages → Source** to **GitHub Actions**.

## Code layout

| Path | What it does |
|---|---|
| `src/lesson/` | Lesson file schema, passage markup parser, compiler |
| `src/grading/` | Compares a student map to the model answer(s) |
| `src/model/` | Map types, editing operations, auto-layout |
| `src/storage/` | `ProgressStore` interface (localStorage now, SCORM later) |
| `src/ui/` | React components; the canvas uses React Flow |

## Roadmap

- **SCORM export**: a per-lesson build plus `imsmanifest.xml`, zipped. The
  app already uses relative paths and hash routing, bundles its lessons, and
  saves progress through the `ProgressStore` interface, so a SCORM 1.2
  implementation can be dropped in.
- Unstated (implicit) premises.
- Objections aimed at an inference rather than a claim (undercutters).
