/* ------------------------------------------------------------------ */
/* The cast: people who recur across everything we post.                */
/* ------------------------------------------------------------------ */

/**
 * A model is a written character sheet, not a photograph.
 *
 * That is deliberate. A reference picture only helps a shot that contains a
 * face, drifts between generations, and is supported by one of our four image
 * providers. A description is deterministic — the same words go into every
 * prompt, this week and in six months — and it still works for a frame that
 * is only two hands over a countertop, which is where a face reference gives
 * the generator nothing at all.
 *
 * So the sheets below are written to be *reproducible*: specific about the
 * things a generator actually renders (skin tone AND undertone, hair texture,
 * face shape, build, hands) and about the register a person carries. They are
 * original people. Anchoring a cast on a named celebrity would fail here
 * twice over — it is the pattern advertising law is built around, and the
 * image providers filter those prompts unevenly, so the cast would come back
 * inconsistent, which is the one thing it exists to prevent.
 */
export interface CastModel {
  id: string;
  /** shown on the chip */
  name: string;
  /** one line, so a picker is readable at a glance */
  headline: string;
  /** the paragraph handed to the image generator */
  sheet: string;
  /** set only for a model built from an uploaded photograph */
  photoUrl?: string | null;
  /** false for the ten that ship with the tool */
  custom: boolean;
}

/**
 * Ten adults, deliberately spread across ages, heritages, builds and
 * registers, so a carousel can be cast without every frame looking like the
 * same person in a different jumper.
 */
export const DEFAULT_CAST: CastModel[] = [
  {
    id: "marisol",
    name: "Marisol Rivera",
    headline: "Early 40s · warm, capable, hands always busy",
    sheet:
      "Marisol Rivera, a Mexican-American woman in her early forties. Warm mid-brown skin with a " +
      "golden undertone. Dark brown wavy hair to the shoulders, a few silver strands at the " +
      "temple, usually pushed back off her face. Strong straight brows, deep laugh lines, a " +
      "square jaw. Medium-full build, broad shoulders. Wide practical hands, short unpainted " +
      "nails, a thin gold band on the right hand. Dresses in rolled-sleeve shirts and aprons; " +
      "small gold hoop earrings. Reads as someone mid-task and completely at ease.",
    custom: false,
  },
  {
    id: "theo",
    name: "Theo Achebe",
    headline: "Late 20s · tall, precise, quietly stylish",
    sheet:
      "Theo Achebe, a Nigerian man in his late twenties. Deep brown skin with a warm undertone " +
      "and a clean matte finish. Hair cropped very short with a sharp hairline; no facial hair. " +
      "High cheekbones, defined jaw, calm steady gaze. Tall, with a lean-muscular build, long " +
      "limbs and a narrow waist. Long slender fingers, neat nails, a slim steel watch on the " +
      "left wrist. " +
      "Wears crisp shirts without a tie, fine knitwear, nothing loud. Reads as considered and " +
      "unhurried.",
    custom: false,
  },
  {
    id: "ingrid",
    name: "Ingrid Halvorsen",
    headline: "Mid 50s · spare, elegant, Nordic calm",
    sheet:
      "Ingrid Halvorsen, a Norwegian woman in her mid fifties. Fair skin with a cool pink " +
      "undertone and visible fine lines around the eyes. Silver-blonde hair in a blunt " +
      "chin-length bob. Long face, pale grey-blue eyes, thin lips, no makeup beyond a little " +
      "colour. A slim upright build, narrow shoulders, straight posture. Slender hands with " +
      "prominent knuckles and short bare nails. Wears oatmeal and stone-coloured knitwear, wide " +
      "linen trousers, no jewellery. Reads as unhurried and exacting.",
    custom: false,
  },
  {
    id: "deven",
    name: "Deven Rao",
    headline: "Mid 30s · broad, outdoorsy, easy grin",
    sheet:
      "Deven Rao, a South Indian man in his mid thirties. Medium-deep brown skin with a neutral " +
      "undertone. Thick black hair pushed straight back, a close-trimmed full beard with a few " +
      "grey hairs at the chin. Round-ish face, heavy brows, a broad easy grin. Stocky and " +
      "broad-chested, thick forearms with dark hair, wide wrists. Large hands, blunt fingers, " +
      "short nails. Wears technical outdoor layers, a canvas cap, worn boots. Reads as warm and " +
      "physically capable.",
    custom: false,
  },
  {
    id: "nadia",
    name: "Nadia Haddad",
    headline: "Early 30s · compact, focused, sleeves up",
    sheet:
      "Nadia Haddad, a Lebanese woman in her early thirties. Olive skin with a green-gold " +
      "undertone. Dark brown tight curls pulled back into a low knot with pieces escaping at " +
      "the front. Thick natural brows, dark eyes, a small mole above the left lip. A compact " +
      "athletic build, defined forearms. Capable hands, a faint burn scar on the right forearm, short " +
      "nails, one plain silver ring. Wears a canvas work apron over a fitted tee, sleeves " +
      "shoved past the elbow. Reads as absorbed in what she is doing.",
    custom: false,
  },
  {
    id: "grace",
    name: "Grace Yoon",
    headline: "Early 60s · small, sturdy, watchful and kind",
    sheet:
      "Grace Yoon, a Korean woman in her early sixties. Light-medium skin with a warm yellow " +
      "undertone, soft and lightly lined. Salt-and-pepper hair in a short layered cut tucked " +
      "behind the ears. Round face, monolid eyes with deep crinkles when she smiles, full " +
      "cheeks. A small sturdy build, a little stooped. Soft small hands with prominent veins and " +
      "short clean nails. Wears layered linen in muted colours, reading glasses on a beaded " +
      "cord. Reads as watchful, warm and entirely unbothered.",
    custom: false,
  },
  {
    id: "malik",
    name: "Malik Osei",
    headline: "Early 20s · lanky, bright, city energy",
    sheet:
      "Malik Osei, a Ghanaian-British man in his early twenties. Dark brown skin with a cool " +
      "undertone. Short twists, faded at the sides. Open expressive face, a gap between the " +
      "front teeth that shows when he laughs, light stubble along the jaw. Tall and slight, " +
      "narrow through the shoulders and hips. Long slim fingers, a few thin beaded bracelets on " +
      "the left wrist. Wears oversized streetwear, a boxy jacket, chunky trainers. Reads as " +
      "quick, funny and slightly restless.",
    custom: false,
  },
  {
    id: "rosa",
    name: "Rosa Beltrán",
    headline: "Late 40s · full-figured, bright, commanding",
    sheet:
      "Rosa Beltrán, a Colombian woman in her late forties. Tan skin with a warm olive " +
      "undertone. Long dark brown hair with a centre part and a clear streak of grey at each " +
      "temple, usually loose. Full face, dark expressive eyes, strong nose, a wide unguarded " +
      "smile. A full-figured build with a soft waist and strong forearms. Broad hands, terracotta nail " +
      "polish, several gold rings. Wears saturated colour — reds, marigold — and large gold " +
      "earrings. Reads as someone who is running the room.",
    custom: false,
  },
  {
    id: "callum",
    name: "Callum Byrne",
    headline: "Late 30s · heavyset, weathered, steady",
    sheet:
      "Callum Byrne, an Irish man in his late thirties. Fair skin, pink across the cheeks and " +
      "nose, dense freckling on the face and forearms. Red-brown hair, thick and a little " +
      "unruly, with a short beard a shade darker. Wide face, pale blue eyes, heavy brow. Broad " +
      "and heavyset through the chest and shoulders. Big weathered hands, cracked knuckles, " +
      "short blunt nails with a little ingrained dirt. Wears a faded canvas work jacket and a " +
      "flannel shirt. Reads as steady and slow to fluster.",
    custom: false,
  },
  {
    id: "yuki",
    name: "Yuki Tanaka",
    headline: "Mid 20s · small-framed, sharp, minimal",
    sheet:
      "Yuki Tanaka, a Japanese woman in her mid twenties. Light skin with a neutral undertone " +
      "and a clear even complexion. Black hair cut blunt at the chin with a straight fringe. " +
      "Oval face, dark eyes, small features, a serious resting expression that breaks easily. " +
      "Small-framed and slim, narrow shoulders. Delicate hands, short square nails, a single " +
      "fine silver ring. Wears oversized tailoring in black and grey, flat shoes, almost no " +
      "jewellery. Reads as precise and self-contained.",
    custom: false,
  },
];

/**
 * Fold the chosen people into an image prompt.
 *
 * Written to survive the frames that have no face in them: the generator is
 * told to carry the skin tone, build and hands through even when the shot is
 * cropped to a pair of forearms, which is the case that a reference photo
 * cannot help with at all.
 */
export function castDirective(
  models: { name: string; sheet: string }[]
): string {
  if (models.length === 0) return "";
  const who = models.map(m => `— ${m.sheet}`).join("\n");
  return (
    "The people in this image are from a fixed cast. Render them exactly as described, " +
    "the same way every time:\n" +
    who +
    "\nIf the framing shows only hands, forearms, feet or a body without a face, those parts " +
    "must still belong to the described person — same skin tone and undertone, same build, " +
    "same nails, same jewellery. Do not substitute anyone else, and do not add extra people " +
    "who are not listed."
  );
}

/** The cast summarised for a prompt that has to choose between them. */
export function castRoster(
  models: { name: string; headline: string }[]
): string {
  return models.map(m => `${m.name} (${m.headline})`).join("; ");
}
