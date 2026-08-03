import { writeFileSync } from "node:fs";

const fields = ["primary","rejected_alternative","enforcement_owner","context_boundary","lifecycle","failure_mode","version_caveat"];

// scores[scenario][sheetIndex] = [7 scores in field order]
const scores = {
  S003: [
    [1,0,1,1,1,1,1],
    [1,0,1,1,0.5,1,0.5],
    [1,0,1,1,1,1,1],
    [1,1,1,1,1,1,1],
  ],
  S009: [
    [1,0,1,1,0.5,0.5,1],
    [1,0,1,1,0.5,0.5,1],
    [1,1,1,1,0.5,1,1],
    [1,0,1,1,0.5,0.5,0.5],
  ],
  S013: [
    [1,1,1,1,1,1,1],
    [1,0,1,1,1,1,1],
    [1,0,1,1,1,1,1],
    [1,1,1,1,1,1,0],
  ],
  S014: [
    [0.5,0,1,1,1,1,0],
    [1,0,1,1,1,1,1],
    [1,1,1,1,1,1,1],
    [1,0,1,1,1,1,1],
  ],
  S016: [
    [0.5,0,1,1,0.5,0,0],
    [1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1],
  ],
  S021: [
    [1,1,1,1,1,0.5,1],
    [1,0.5,1,1,1,1,0],
    [1,0.5,1,1,1,0.5,0.5],
    [1,1,1,1,1,0.5,1],
  ],
  S036: [
    [1,1,1,1,1,1,0.5],
    [1,0,1,1,1,1,1],
    [0,1,1,1,1,0.5,0.5],
    [1,0.5,1,1,1,1,1],
  ],
  S038: [
    [1,0,1,1,1,1,1],
    [1,0,1,1,1,0.5,1],
    [1,0,1,1,1,1,0.5],
    [0,0,1,1,1,0,0],
  ],
  S047: [
    [1,0,1,1,1,1,0],
    [1,0,1,1,1,0.5,0.5],
    [1,0,1,1,1,1,0],
    [1,0,1,1,1,1,0],
  ],
  S055: [
    [1,0,1,1,1,0.5,1],
    [1,0,1,1,1,1,1],
    [1,0,1,1,1,0.5,1],
    [1,0,1,1,1,0.5,1],
  ],
};

const lines = [];
for (const [scenario, sheets] of Object.entries(scores)) {
  sheets.forEach((vals, si) => {
    if (vals.length !== 7) throw new Error(`bad row ${scenario} sheet ${si+1}`);
    vals.forEach((score, fi) => {
      lines.push(JSON.stringify({ scenario, sheet: si + 1, field: fields[fi], score, grader: "g2" }));
    });
  });
}

if (lines.length !== 280) throw new Error(`expected 280 records, got ${lines.length}`);

const out = "C:\\Users\\Shake\\AppData\\Local\\Temp\\claude\\P--ClaudeExt-QuestionExtension\\260040da-5e33-434b-b658-3f1f525e0bc4\\scratchpad\\ccx-c-drive\\tests\\tier3\\grades-v2-g2-batch-2.jsonl";
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`PASS wrote ${lines.length} records to ${out}`);
