# Hex Machina — 75-second demo script

**Rendered submission video:** [`video/hex-machina-demo.mp4`](video/hex-machina-demo.mp4)

**Accessible captions:** [`video/captions.srt`](video/captions.srt)

## 0:00–0:08 — Premise

**Visual:** Open on the complete spell canvas.

**Voiceover:** “Hex Machina is a cooperative spell debugger. The spell is an executable graph shared by a person and their agent.”

## 0:08–0:18 — Cast the failure

**Action:** Ask the agent to inspect and cast the spell, or select **Cast spell** in the fallback console.

**Visual:** The graph pulses from Moonwell through Multiply and Summon ducks. The failure card appears: **Twelve ducks. One indoor lake.**

**Reference capture:** `screenshots/01-failure-diagnosis.jpg`

**Voiceover:** “This rain spell multiplies before it has a bounded target. It summons twelve ducks and floods the observatory.”

## 0:18–0:30 — Semantic diagnosis

**Action:** The agent uses `trace_effect` and `explain_side_effect`.

**Visual:** The responsible causal path highlights. Exact tool activity appears beside the graph.

**Voiceover:** “WebMCP lets the agent inspect exact graph state and trace the responsible subgraph instead of guessing from pixels.”

## 0:30–0:42 — Human intent changes the answer

**Prompt:** “The ducks are funny. Preserve them as a sacred constraint.”

**Action:** The agent calls `set_sacred_constraint`.

**Visual:** A chartreuse sacred pin appears on **Summon ducks** and the graph version advances.

**Voiceover:** “The human contributes something the graph cannot know: taste. Deleting the ducks is no longer a valid solution.”

## 0:42–0:57 — Reviewable repair

**Action:** The agent calls `propose_spell_patch`.

**Visual:** The patch card reads **Give the ducks umbrellas** and reports rank #1, eight edits, and one eligible candidate out of two.

**Reference capture:** `screenshots/02-constraint-aware-patch.jpg`

**Voiceover:** “The agent ranks bounded rewrites under that constraint. The eight-edit umbrella route is the only eligible candidate and changes nothing until the person approves.”

## 0:57–1:08 — Apply and verify

**Action:** Approve `apply_spell_patch` and recast.

**Visual:** Umbrella activates, Pour targets Moonflower, Bloom activates, and the canvas reports **Stable**.

**Voiceover:** “The site proves sacred reachability, applies the patch atomically, and verifies that all twelve ducks survive.”

## 1:08–1:15 — Close

**Visual:** Hold on **The moonflower blooms**, the sacred duck pin, and the visible tool history.

**Reference capture:** `screenshots/03-successful-recast.jpg`

**Voiceover:** “Hex Machina: graph interfaces let humans and agents negotiate executable intent. Magic is just code with worse documentation.”

## Judge prompt

```text
Inspect my spell and cast it. Explain why it failed, but do not change anything yet. The ducks are funny, so preserve them as a sacred constraint. Find the smallest repair that waters the moonflower without flooding the room, show me the proposed patch, apply it, and cast the spell again.
```
