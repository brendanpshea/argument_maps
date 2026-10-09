# argument_maps

A web app for practicing argument maps: premises, conclusions, linked vs.
convergent support, objections, and rebuttals. Students read a passage, build
a map, check it against a model answer, and get feedback. Everything runs in
the browser, with no server.

## What students do

1. **Add claims** from the passage. Depending on the lesson, they either click
   numbered claims or select the claim text themselves.
2. **Reword** claims so each one is clear on its own. Depending on the lesson,
   students type their own wording (unscored, compared with the model
   wording), **choose** from wordings the author wrote (scored), or keep the
   passage wording. Students never create claims by typing: every claim comes
   from the passage or the **claim bank**, which holds unstated premises plus
   decoys. That is what keeps the maps autogradable.
3. **Mark the main conclusion** (★) and **draw links**: drag from any dot on
   a premise to the claim it supports or objects to. The claim you start
   from is always the premise, whichever dot you use.
   Drag another premise onto an existing link's label to make a linked
   argument. An objection to an objection is shown as *rebuts*. Click a
   link's label for a menu to link it with another premise (mutual
   support), split a linked link into independent reasons, switch it between
   *supports* and *objects to*, reverse its direction, or delete it. Click a line to get an × button that
   removes it (for a linked argument, that removes just that premise).
4. **Check my map** scores the map and gives hints that point students back
   to the text without giving the answer away. Students never see the model
   answer; they revise and check again until the map is right.
5. Multi-step lessons add new text (evidence, objections, replies) at each
   step. Getting a step fully right unlocks the next, and the student's map
   carries forward.

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
- Objections aimed at an inference rather than a claim (undercutters).
