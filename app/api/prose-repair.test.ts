import { describe, expect, it } from "vitest";
import { expandThinProse } from "./routers/generate.js";
import type { SlideDeck } from "../contracts/types.js";

/** A 3-slide news deck where slides 0 and 2 are thin (caption-length text)
 *  and slide 1 already carries a full article body. */
function newsDeck(): SlideDeck {
  return {
    topic: "Technology in the Middle Ages",
    level: "B1",
    imageStyle: "sketch",
    slides: [
      {
        title: "Vertical Watermills Automate Textile Operations",
        components: [
          { type: "prose", paragraphs: ["Watermills — a developing story on this beat."] },
          { type: "image", prompt: "a watermill", caption: "An 11th-century watermill" },
        ],
      },
      {
        title: "Heavy Ploughs Transform Agriculture",
        components: [
          {
            type: "prose",
            paragraphs: [
              "Across the northern plains this season, farmers report that the heavy wheeled carruca plough has broken clay soils no scratch plough could work. Teams of six and eight oxen now turn deep furrows on manor fields from Flanders to Saxony, and stewards say the autumn sowing covered half again as much land as in living memory.",
              "The plough's iron coulter and mouldboard, smiths explain, slice and turn the sod in a single pass, burying weeds and bringing fresh soil to the surface. Village assemblies are already dividing fields into long strips to spare the ox teams costly turns, a change elders call the greatest reordering of the land since the old emperors.",
            ],
          },
          { type: "image", prompt: "a plough", caption: "A carruca plough" },
        ],
      },
      {
        title: "Cathedral Builders Raise New Vaults",
        components: [{ type: "image", prompt: "a cathedral", caption: "Masons at work" }],
      },
    ],
  } as SlideDeck;
}

const OPTS = {
  topic: "Technology in the Middle Ages",
  purpose: "news",
  level: "B1",
  textDensity: "standard" as const,
  newsPeriod: "1030 AD",
  paraFloor: 3,
  newsMinParas: 2,
};

const LONG_PARAS = [
  "Millers along the Rhine report that upright wheels driven by the river's current now full cloth and hammer iron without a single hand at the crank. The new works, raised this spring at three manors, turn from dawn to dusk and are said to do the labour of forty fullers.",
  "Lords who financed the wheels collect a toll in cloth and bloom-iron, and guildsmen from two towns have petitioned to study the gearing. Church clerks, for their part, praise the works for freeing brothers to their prayers, citing the abbey mill that has run since Michaelmas.",
];

describe("expandThinProse (prose repair pass)", () => {
  it("rewrites thin slides with the AI's real paragraphs and leaves full slides alone", async () => {
    const deck = newsDeck();
    const fullBody = deck.slides[1].components[0];
    const requested: number[] = [];
    const repaired = await expandThinProse(deck, OPTS, async (args) => {
      const payload = JSON.parse(args.messages[1].content) as { slides: { i: number }[] };
      requested.push(...payload.slides.map((s) => s.i));
      return {
        text: JSON.stringify({
          slides: payload.slides.map((s) => ({ i: s.i, paragraphs: LONG_PARAS })),
        }),
        provider: "gemini",
        source: "env",
      };
    });
    // only the two thin slides were sent for repair
    expect(requested.sort()).toEqual([0, 2]);
    // slide 0's caption-length filler was replaced with the real article body
    const s0 = repaired.slides[0].components.find((c) => c.type === "prose");
    expect(s0?.type === "prose" && s0.paragraphs).toEqual(LONG_PARAS);
    // slide 2 (no prose at all) gained a prose component up front
    expect(repaired.slides[2].components[0]).toEqual({ type: "prose", paragraphs: LONG_PARAS });
    // the already-full slide was not touched
    expect(repaired.slides[1].components[0]).toBe(fullBody);
  });

  it("asks the news register for the chosen era and bans meta-text", async () => {
    let system = "";
    await expandThinProse(newsDeck(), OPTS, async (args) => {
      system = args.messages[0].content;
      return { text: '{"slides":[]}', provider: "gemini", source: "env" };
    });
    expect(system).toContain('"1030 AD"');
    expect(system).toContain("ARTICLE BODY");
    expect(system).toContain("NEVER meta-text");
    expect(system).toContain("at least 110 words");
  });

  it("returns the deck unchanged when no provider is available", async () => {
    const deck = newsDeck();
    const before = JSON.stringify(deck);
    const repaired = await expandThinProse(deck, OPTS, async () => null);
    expect(JSON.stringify(repaired)).toBe(before);
  });

  it("skips repair entirely when every slide already meets the floors", async () => {
    const deck = newsDeck();
    deck.slides = [deck.slides[1]]; // only the full slide
    let called = false;
    await expandThinProse(deck, OPTS, async () => {
      called = true;
      return null;
    });
    expect(called).toBe(false);
  });
});
