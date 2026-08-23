/* Inkfall — a word-hunt board for the arcade.
   Drag through touching letters to spell words before your ink runs dry:
   every step of a chain costs ink, every banked word refills it, and the ink
   slowly dries all by itself. Three pages of goals to clear the folio.
   Everything lives in this one classic script, wrapped in one IIFE. */

(function () {
  "use strict";

  /* ── helpers ─────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ── dom ─────────────────────────────────────────────── */
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const hudScore = $("hud-score");
  const hudWords = $("hud-words");
  const hudGoal = $("hud-goal");
  const hudInkfill = $("inkfill");
  const wordline = $("wordline");
  const overlay = $("overlay");
  const ovTitle = $("ov-title");
  const ovText = $("ov-text");
  const ovBtn = $("ov-btn");
  const btnPause = $("btn-pause");
  const btnSound = $("btn-sound");
  const btnRestart = $("btn-restart");

  /* ── constants ───────────────────────────────────────── */
  const COLS = 6;
  const ROWS = 6;
  const N = COLS * ROWS;
  const CELL = 80; // virtual units per cell (canvas is 480×480)
  const SIZE = CELL * COLS;
  const MIN_LEN = 3;

  const INK_MAX = 100;
  const INK_DECAY_PER_SEC = 0.95; // the ink dries on its own
  const STEP_BASE = 0.9; // ink cost of the k-th letter: base + slope*(k-1)
  const STEP_SLOPE = 0.35;
  const BANK_BASE = 2; // ink gained banking an L-letter word
  const BANK_PER_LETTER = 1.7;
  const BANK_CAP = 40;
  const LEVEL_INK_BONUS = 15;

  const GOAL_1 = 50;
  const GOAL_STEP = 50;
  const LAST_LEVEL = 3;

  /* letter dice — weighted English distribution, vowel-boosted */
  const DICE = [
    "AAEEGN",
    "ABBJOO",
    "ACHOPS",
    "AFFKPS",
    "AOOTTW",
    "CIMOTU",
    "DEILRX",
    "DELRVY",
    "DISTTY",
    "EEGHNW",
    "EEINSU",
    "EHRTVW",
    "EIOSST",
    "ELRTTY",
    "HIMNUQ",
    "HLNNRZ",
    "AAAEEE",
    "IIEEEE",
    "OOAUUI",
    "NNRSTT",
    "LLRDSG",
    "BCMPFY",
    "GHKPRW",
    "JKQXZV",
    "MNBVCX",
    "AAIIUU",
    "EOOAAE",
    "TTDDNN",
    "SSFFHH",
    "GGPPBB",
    "CCMMWW",
    "YYKKJJ",
  ];

  const LETTER_SCORES = {
    A: 1,
    B: 3,
    C: 3,
    D: 2,
    E: 1,
    F: 4,
    G: 2,
    H: 4,
    I: 1,
    J: 8,
    K: 5,
    L: 1,
    M: 3,
    N: 1,
    O: 1,
    P: 3,
    Q: 10,
    R: 1,
    S: 1,
    T: 1,
    U: 1,
    V: 4,
    W: 4,
    X: 8,
    Y: 4,
    Z: 10,
  };

  /* ── dictionary ──────────────────────────────────────── */
  const RAW_WORDS =
    "ace act add age ago aid ail aim air ale all and ant any ape apt arc are arm art ash ask ate awe axe aye " +
    "bad bag ban bar bat bay bed bee beg bet bid big bin bit boa bob bog bow box boy bra bud bug bun bus but buy " +
    "cab cam can cap car cat caw cob cod cog con cop cot cow coy cry cub cue cup cut dab dam day den dew did die " +
    "dig dim din dip doe dog don dot dry dub dud due dug duo dye ear eat ebb eel egg ego elf elk elm emu end era " +
    "erg err eve ewe eye fad fan far fat fax fed fee fen few fib fig fin fir fit fix flu fly foe fog for fox fry " +
    "fun fur gag gap gas gel gem get gig gin gnu got gum gun gut guy gym had hag ham has hat hay hem hen her hew " +
    "hex hey hid him hip his hit hob hoe hog hop hot how hub hue hug hum hut ice icy ill imp ink inn ion ire irk " +
    "its ivy jab jam jar jaw jay jet jig job jog jot joy jug jut keg ken key kid kin kit lab lad lag lap law lax " +
    "lay lea led leg let lid lie lip lit lob log lot low lug lye mad man map mar mat maw may men met mew mid mix " +
    "mob mod mop mow mud mug nab nag nap net new nil nip nod nor not now nun nut oak oar oat odd ode off oil old " +
    "one opt orb ore our out owe owl own pad pal pan pap par pat paw pay pea peg pen pep per pet pew pie pig pin " +
    "pit ply pod pop pot pro pry pub pug pun pup pus put rag ram ran rap rat raw ray red rib rid rig rim rip rob " +
    "rod roe rot row rub rug rum run rut rye sad sag sap sat saw say sea see set sew she shy sin sip sir sis sit " +
    "six ski sky sly sob sod son sop sow soy spa spy sty sub sue sum sun tab tad tag tan tap tar tax tea ten the " +
    "thy tic tie tin tip toe tog ton too top tot tow toy try tub tug two urn use van vat vet vex via vie vow wad " +
    "wag war was wax way web wed wee wet who why wig win wit woe wok won woo wow yak yam yap yaw yes yet yew you " +
    "zap zip zoo " +
    "able ache acid acre aged aide ally also alto amid ante apes arch area arms army arts atom aunt auto avid axis " +
    "baby back bail bait bake bald bale ball band bane bang bank bans bard bare bark barn bars base bath bats bead " +
    "beak beam bean bear beat beds beef been beer bees bell belt bend bent best bets bike bill bind bird bite bits " +
    "blob blot blow blue blur boar boat body boil bold bolt bomb bond bone book boom boot bore born boss both bout " +
    "bowl brag bran brat brew brim brow buck buds bugs bulk bull bump bunk burn bury bush bust busy buys cage cake " +
    "calf call calm came camp cane cans cape caps card care carp cars cart case cash cask cast cats cave cell cent " +
    "chap char chat chef chew chic chin chip chop chum cite city clad clam clan clap claw clay clip club clue coal " +
    "coat coax coil coin cold colt comb come cone cook cool cope cops copy cord core cork corn cost coup cove cows " +
    "cozy crab crag crew crib crop crow cube cues cuff cult cups curd cure curl curt cusp cute dais dame damp dams " +
    "dare dark darn dart dash data date dawn days dead deaf deal dean dear debt deck deed deem deep deer defy dell " +
    "demo dent deny desk dial dice died dies diet digs dike dime dine ding dips dire dirt disc dish disk dive dock " +
    "does dogs dole doll dolt dome done doom door dose dots dove down doze drab drag dram draw drew drip drop drug " +
    "drum dual duck duct dude duel dues duet dull duly dumb dump dune dung dunk dusk dust duty dyed each earl earn " +
    "ears ease east easy eats echo eddy edge edgy eels eggs egos elks elms else emit ends envy epic eras errs euro " +
    "even ever eves evil ewes exam exit eyed eyes face fact fade fads fail fair fake fall fame fans fare farm fast " +
    "fate faun fawn faze fear feat feed feel fees feet fell felt fend fern feud figs file fill film find fine fins " +
    "fire firm fish fist fits five fizz flag flak flap flat flaw flax flea fled flee flew flex flip flit floe flog " +
    "flop flow flue flux foam foal foes fold folk fond font food fool foot ford fore fork form fort foul four fowl " +
    "foxy fray free fret frog from fuel full fume fund funk furl fury fuse fuss fuzz gain gait gala gale gall game " +
    "gang gaps garb gash gasp gate gave gaze gear gems gene gent germ gets gift gigs gild gill gilt gird girl gist " +
    "give glad glee glen glib glob glow glue glum glut gnat goad goal goat goes gold golf gone gong good gore gory " +
    "gosh gout gown grab gram gray grew grey grid grim grin grip grit grow grub gulf gull gulp gums gust guts guys " +
    "hail hair half hall halo halt hand hang hard hare hark harm harp hash hate haul have hawk haze hazy head heal " +
    "heap hear heat heed heel heft heir held helm help hemp herb herd here hero hers hewn hide high hike hill hint " +
    "hire hits hive hoax hobo hogs hold hole holy home hone honk hood hoof hook hoop hoot hope hops horn hose host " +
    "hour howl hubs hues hugs hull hums hung hunk hunt hurl hurt hush husk hymn icon idea idle idly idol inch into " +
    "ions iota iris iron isle itch item jade jail jams jars jaws jazz jeep jeer jest jets jibe jigs jilt jinx jive " +
    "jobs jogs join joke jolt joys judo jugs jump junk jury just jute keel keen keep kegs kelp kept keys kick kids " +
    "kiln kilt kind king kiss kite kits knee knew knit knob knot know labs lace lack lacy lads lady laid lain lair " +
    "lake lamb lame lamp land lane laps lash lass last late lava lawn laws lazy lead leaf leak lean leap learn lease " +
    "leash least leave ledge leech lefty legal lemon lends level lever light liked likes lilac limbs limes limit lined " +
    "linen liner lines links lions lists liter lived liver lives llama loads loans lobby local locks lodge logic " +
    "logos loops loose lords loser loses lotus loved lover loves lower loyal lucid lucky lumps lunar lunch lungs " +
    "lurch lurked lying lyric madam magic magma maids mails maize major maker makes males malls mango mania manor " +
    "maple march mares marks marry masks mason masts match mates maxim maybe mayor meals means meant meats medal " +
    "media medic meets melon melts mends menus mercy merge merit merry metal meter metro midst might miles mimic " +
    "minds mined mines minor minted minus mirth miser mists mixed mixer mixes moans moats mocha model modem moist " +
    "molar moles money month moons moose mopes moral moss most moth move much muck muff mugs mule muse must mute " +
    "mutt myth nabs nail name nape naps navy near neat neck need neon nest news newt next nibs nice nick nigh nine " +
    "node nods none nook noon norm nose nosy note noun nude numb nuns nuts oaks oars oath oats obey odds odes oils " +
    "oily okay okra omen once ones only onto ooze opal open opts opus oral orbs ores ouch ours oust outs oval oven " +
    "over owed owes owls owns pace pack pact pads page paid pail pain pair pale pall palm pane pang pans pant park " +
    "pars part pass past pate path pats pave pawn paws pays peak peal pear peas peat peck peek peel peer pegs pelt " +
    "pens pent peon perk pert pest pets pews pick pier pies pigs pike pile pill pine ping pink pint pipe pity plan " +
    "play plea pled plod plot plow ploy plug plum plus pods poem poet poke pole poll polo pomp pond pony pool poor " +
    "pope pops pore pork port pose posh post posy pots pour pout pray prep prey prim prod prom prop pros prow pubs " +
    "puck puff pull pulp pump punk puns punt puny pure purr push puts quip quit quiz race rack racy raft rage rags " +
    "raid rail rain rake ramp rang rank rant rats rave rays raze read real ream reap rear redo reds reed reef reek " +
    "reel refs rein rely rend rent rest revs ribs rice rich ride rife rift rigs rims rind ring rink riot ripe rips " +
    "rise risk rite road roam roar robe rock rode rods roll romp roof rook room root rope rose rosy rote rots rout " +
    "rove rude rugs ruin rule rums rune rung runs runt ruse rush rust sack safe saga sage sags said sail sake sale " +
    "salt same sand sane sang sank saps sash save says scab scam scan scar seal seam sear seas seat sect seed seek " +
    "seem seen seep sees self sell semi send sent sets sewn sham shed shim shin ship shod shoe shoo shop shot show " +
    "shun shut sick side sift sigh sign silk sill silo silt sine sing sink sins sips sire site sits size skew skid " +
    "skim skin skip skis slab slam slap slat sled slew slid slim slip slit slob sloe slog slop slot slow slug slum " +
    "slur smog smug snag snap snip snob snow snub snug soak soap soar sobs sock soda sofa soft soil sold sole solo " +
    "some song sons soon soot sore sort soul soup sour sown sows span spar spas spat sped spin spit spot spry spud " +
    "spun spur stab stag star stay stem step stew stir stop stow stub stud stun subs such suck suds sued sues suit " +
    "sulk sung sunk suns sure surf swab swag swam swap swan swat sway swim swig tack tact tags tail take tale talk " +
    "tall tame tamp tang tank taps tape task taut taxi teak teal team tear teas teem teen tell tend tens tent term " +
    "tern test text than that thaw thee them then they thin this thou thud thug thus tick tide tidy tied tier ties " +
    "tile till tilt time tine tins tint tiny tips tire toad toga toil told toll tomb tome tone tong tons took tool " +
    "toot tops tore torn toss tots tour tout town tows toys tram trap tray tree trek trim trio trip trod trot troy " +
    "true tuba tube tubs tuck tuft tugs tuna tune turf turn tusk twig twin twit type typo ugly undo unit unto upon " +
    "urge urns used user uses vain vale vans vase vast veal veer veil vein vend vent verb very vest veto vets vial " +
    "vibe vice view vile vine visa void volt vote vows wade wads waft wage wags waif wail wait wake walk wall wand " +
    "wane want ward ware warm warn warp wars wart wary wash wasp watt wave wavy waxy ways weak wean wear webs weds " +
    "weed week weep weld well welt went wept were west what when whim whip whom wick wide wife wigs wild will wilt " +
    "wind wine wing wink wins wipe wire wise wish wisp with wits woes woke wolf womb wont wood wool word wore work " +
    "worm worn wove wrap wren yard yarn yawl yawn year yell yoga yoke yolk your zeal zero zest zinc zone zoom " +
    "about above abuse acorn actor acute adapt admit adopt adore adult after again agent agile aging agree ahead " +
    "aided aisle alarm album alert algae alias alibi alien align alike alive allow alloy alone along aloud alpha " +
    "altar alter amber amble amend amiss among ample angel anger angle angry ankle annoy apart apple apply apron " +
    "ardor arena argue arise armor aroma arose array arrow ashes aside askew asset atlas attic audio audit avail " +
    "awake award aware awful axiom bacon badge badly baker bales balls banjo banks barge basic basin basis batch " +
    "beach beads beams beans beard bears beast beats began begin begun being bells belly below belts bench berry " +
    "bikes bills birch birds birth bison black blade blame bland blank blast blaze bleak blend bless blind blink " +
    "bliss block bloom blown blues bluff blunt blush board boast boats bolts bones books boost booth boots bored " +
    "botch bound bowed bowel boxer boxes brace braid brain brake brand brass brave bread break breed brick bride " +
    "brief brine bring brink brisk broad broke brook broom broth brown brush build built bulbs bulge bulky bulls " +
    "bumps bunch bunny burly burnt burst bushy buyer cabin cable cache cacti cakes calls camel camps canal candy " +
    "canoe cards cargo carts carve cases catch cater cause caves cease cedar cells cents chafe chain chair chalk " +
    "charm chart chase cheap cheat check cheek cheer chess chest chick chief child chili chill chime chips chirp " +
    "chive chose churn cider cigar cinch circa cited civic civil claim clamp clang clash clasp class claws clean " +
    "clear clerk click cliff climb cling clink cloak clock clone close cloth cloud clown clubs clues clump clung " +
    "coast coats cobra cocoa coils coins colon color comet comfy comic conch condo coral cords costs couch cough " +
    "could count court cover crack craft crane crank crash crate crawl crazy cream credo creed creek creep crest " +
    "cribs crime crisp crook cross crowd crown crude cruel crumb crush crust cubic curls curly curse curve cycle " +
    "daily dairy daisy dance dared dares dates dawns deals dears death debit debts debut decay decks decor decoy " +
    "deeds delay delta dense depth desks deter devil diary dimes diner dirty disco ditch ditto divan diver dives " +
    "dizzy docks dodge doing dolls donor donut doors doses doubt dough dozen draft drain drake drama drank drape " +
    "drawl drawn draws dread dream dress dried drier drift drill drink drive droll drone drool droop drops drove " +
    "drown drums drunk dryer ducky dummy dunes dusty dwarf dwell dying eager eagle early earns earth eased easel " +
    "eases eaten eater eaves ebony edges eight elbow elder elect elite email embed ember emote empty ended enemy " +
    "enjoy enter entry envoy equal equip erase erect erode erupt essay ether ethic ethos evade event every evict " +
    "evoke exact exalt excel exert exile exist expel extol extra exult fable faced faces facts faded fails faint " +
    "fairy faith false fancy farms fatal fault favor fears feast feign fells fence feral ferry fever fewer fiber " +
    "field fiend fiery fifth fifty fight filed files fills films filth final finch finds finer fires first fishy " +
    "fists fixed fixes flags flair flake flame flank flare flash flask fleas fleet flesh flies fling flint flirt " +
    "float flock flood floor flora floss flour flown flows fluid flung flush flute foamy focal focus foggy folds " +
    "folks fonts foods fools force forge forgo forms forth forty forum found foyer frail frame franc fraud freak " +
    "freed frees fresh fried fries frisk frogs frost fully funds funny fused fussy fuzzy gains gales gangs gates " +
    "gauge gaunt gears geese genie germs ghost giant gifts girls given gives gizmo gland glare glaze gleam glide " +
    "globe gloom glory gloss glove gnats goals goats going goners goods goofy gorge gouge gourd grace grade grain " +
    "grand grant grape graph grasp grass grave gravy graze great greed green greet grief grill grime grind grins " +
    "gripe groan groom grope gross group grove growl grown grows grunt guard guess guest guide guild guilt gulls " +
    "gully gumbo gusto gusty habit hairs hairy halls hands handy hangs happy hardy hares harps harsh haste hasty " +
    "hatch haunt haven havoc hazel heads heals heaps heard hears heart heath heave heavy hedge hefty heirs hello " +
    "helps hence herds herbs hides highs hills hinge hints hippo hoard hobby holds holes honey honors hoops hoped " +
    "hopes horde horns horse hosts hotel hound hours house hover howls human humid humor hunks hunts hurry hurts " +
    "husky hutch hydra hyena icily icing icons ideal ideas idiom idiot idled idler igloo image imbue imply inbox " +
    "incur index inept inert infer inlet inner input irony issue itchy items ivory jaunt jeans jelly jewel joins " +
    "joint jokes jolly jolts judge juice juicy jumbo jumps juror kayak keels keeps kicks kills kinds kings kiosk " +
    "kites knack kneel knees knelt knife knits knobs knock knoll knots known knows labor laced laces lacks lakes " +
    "lambs lamps lands lanes lapse large larva lasso lasts latch later latex laugh lawns layer leads leafy leaks " +
    "leans leaps learn lease ledges legacy legend lenses lentil level lever light liked lilac limbs limes limits " +
    "lined linen liner links lions liter lived lives loads loans lobby local locks lodge logic logos loops loose " +
    "lords loser loses lotus loved lover loves lower loyal lucid lucky lunch lurch lungs lying lyric macaw macho " +
    "macro madly magic magma maize maker makes males malls mango mania manor maple march mares marks marry masks " +
    "mason masts match mates maxim maybe mayor meals means meant meats medal media medic meets melon melts mends " +
    "menus mercy merge merit merry metal meter metro midst might miles mimic minds mines minor minus mirth miser " +
    "mists mixed mixer mixes moans moats mocha model modem moist molar moldy money month moons moose moral mossy " +
    "motels moths motor mound mount mourn mouse mouth moved mover moves movie mower muddy mules mummy munch mural " +
    "murky mushy music musky musty muted myths naive naked named names nanny nasal nasty naval navel needs nerve " +
    "nests never newer newly nicer niche niece night nines noble nodes noise noisy nomad noose norms north notch " +
    "noted notes nouns novel nudge nurse nutty nylon oasis oaths obese occur ocean octet oddly odors offer often " +
    "oiled olive omega omens onion onset opens opera opted optic orbit order organ other otter ought ounce outdo " +
    "outer ovals ovens overt owing owner oxide ozone paced paces packs pacts pagan pages pails pains paint pairs " +
    "palms panda panel panic pants paper parks parts party pasta paste pasty patch paths patio pause paved paves " +
    "pawns peace peach peaks pearl pears pecan pedal peers pelts penal pence penny perch peril perky pesky pesto " +
    "petals petty phase phone phony photo piano picks piece piety piggy piles pills pinch pined pines pints pitch " +
    "pivot pixel pixie pizza place plaid plain plane plank plans plate plays plaza plead pleat plied plier plies " +
    "plots pluck plugs plumb plume plush poach poems poets point poise poker pokes polar poles polka polls ponds " +
    "pools pores ports posed poser poses posts pouch pound pours power prank prawn preen press price pride pried " +
    "prime primo print prior prism privy prize probe promo prone prong proof props prose proud prove prowl proxy " +
    "prune psalm pulse pumps punch pupil puppy purse pushy putty quack quail quake qualm quart quash quasi queen " +
    "queer quell query quest queue quick quiet quill quilt quirk quite quota quote rabid races racks radar radio " +
    "rafts rails rainy raise rally ranch range ranks rapid rarer rated rates ratio raven rayon razor reach react " +
    "reads ready realm rebel recap recur reeds reefs refer regal reign relax relay relic remit renal renew rents " +
    "repay reply rerun reset resin rests retro reuse revel rhyme rider rides ridge rifle right rigid rings rinse " +
    "ripen risen rises risks rites rival river roads roast robes robin robot rocks rocky rodeo rogue roles rolls " +
    "roman roomy roost roots ropes roses rotor rouge rough round rouse route rover royal ruddy ruler rules rumor " +
    "runes rungs runny rural rusty sadly safer sails saint salad sales salon salsa salty sandy satin sauce sauna " +
    "saved saves savor scale scalp scaly scamp scans scare scarf scary scene scent scoff scold scoop scoot scope " +
    "score scorn scout scowl scrap screw scrub seals seams seats sedan seeds seeks seems seize sells sends sense " +
    "serve setup seven sever shack shade shady shaft shake shaky shale shall shame shank shape share shark sharp " +
    "shave shawl shear sheds sheen sheep sheer sheet shelf shell shift shine shiny ships shirt shock shoes shone " +
    "shook shoot shops shore short shots shout shove shown shows shrub shrug shuts sides siege sifts sighs sight " +
    "signs silky silly since sinew singe sings sinks sired siren sites sixth sixty sizes skate skier skies skill " +
    "skimp skins skirt skull skunk slabs slack slain slang slant slaps slate slave sleek sleep sleet slept slice " +
    "slick slide slime slimy sling slink slips slits slope slots slump slums slung slurp slush slyly smack small " +
    "smart smash smear smell smelt smile smirk smite smith smock smoke smoky snack snail snake snaps snare snarl " +
    "sneak sneer snide sniff snipe snoop snore snort snout snowy snuck soaks soapy sober socks soggy soils solar " +
    "soled soles solid solve sonar songs sonic sooty sorry sorts souls sound soups south space spade spare spark " +
    "spasm spawn speak spear speck speed spell spend spent spice spicy spied spies spike spill spine spins spite " +
    "splat split spoil spoke spoof spook spool spoon sport spots spout spray spree sprig spurn spurt squad squat " +
    "squid stack staff stage staid stain stair stake stale stalk stall stamp stand stare stark stars start stash " +
    "state stave stays stead steak steal steam steed steel steep steer stems steps stern stick stiff still stilt " +
    "sting stink stint stock stoic stoke stole stomp stone stony stood stool stoop stops store stork storm story " +
    "stout stove strap straw stray strip strut stuck studs study stuff stump stung stunt style suave sugar suite " +
    "sulky sunny super surge sushi swamp swarm swath sweat sweep sweet swell swept swift swims swine swing swipe " +
    "swirl swish swoon swoop sword swore sworn syrup table tabby tacit tacks taffy tails taken taker takes tales " +
    "talks tally talon tamed tames tango tangy tanks taped tapes tardy tarot tasks taste tasty taunt teach teams " +
    "tears tease teddy teeth tells temps tenor tense tenth tents terse tests thank thaws theft their theme there " +
    "these thick thief thigh thing think third thorn those three threw throb throw thumb thump tiara tidal tiers " +
    "tiger tight tiled tiles tilts timed timer times timid tipsy tired tires titan title toads toast today tokens " +
    "tolls tombs tones tongs tonic tools tooth topaz topic torch torso total totem touch tough tours towel tower " +
    "towns toxic trace track tract trade trail train trait tramp traps trash trawl tread treat trees trend triad " +
    "trial tribe trick tried tries trill trios tripe trite troll troop trout trove truce truck truly trump trunk " +
    "truss trust truth tubes tulip tummy tumor tunas tuned tunes tunic turbo turns tusks tutor twang tweak tweed " +
    "twice twigs twine twins twirl twist tying udder ulcer ultra uncle under undid undue unfit unify union unite " +
    "unity untie unzip upset urban urged urges usage users usher using usual utter vague valet valid valor value " +
    "valve vapor vault veins venom vents venue verbs verse vests vexed vicar video views vigil vigor villa vinyl " +
    "viola viper viral virus visit visor vista vital vivid vocal vodka vogue voice volts vomit voted voter votes " +
    "vouch vowel vying wacky waded wades wafer wages wagon waist waits waive wakes walks walls waltz wants wards " +
    "wares warms warns warts wash wasps waste watch water watts waved waves waxed wears weary weave wedge " +
    "weeds weeks weigh weird whales wharf wheat wheel where which whiff while whims whirl whisk white whole whose " +
    "widen wider widow width wield wilds wills wilts winds windy wines wings wiped wires wiser wives woken woman " +
    "women woods woody words wordy works world worms worry worse worst worth would wound woven wrath wreck wrist " +
    "write wrong wrote yacht yards yarns yawns years yeast yells yield yikes yodel yolks young yours youth yummy " +
    "zebra zesty zippy zonal zooms " +
    "absent absorb accent accept access accuse across acting action active actors adapts admire advice advise " +
    "affair affect afford afraid agency agenda agreed almost alumni amount amused anchor angles animal annual " +
    "answer anthem anyhow appeal appear apples arcade archer around arrays arrive artist asking aspect assess " +
    "assist assume attach attack attend author autumn avenue awards babies backup badges bagels bakery balance " +
    "ballad bamboo banana bandit banish barber barely bargain barley basket beacon beaten beauty become before " +
    "beggar behalf behave behind belief belong benches better beyond bigger binary binder biology bishop bitter " +
    "blazer bleach blended blister blocks blossom blouse boiler border boring bottle bought bounce branch brands " +
    "breach breaks breath bridge briefs bright brings broken bronze brooch brother brought bubble bucket buckle " +
    "budget buffer builder bullet bundle bungle burden bureau buried butter button buying candle cannot canvas " +
    "canyon capable capital captain capture careful carpet carrot castle casual cattle caught celery cellar cement " +
    "censor centre cereal chance change chapel charge charms cheats checks cheese cherry chilled chimney chosen " +
    "chrome circle circus cities civics claims classic clause clever client climax closed closer clover clutch " +
    "coarse coated coffee coffin collar colony colors combat comedy comets coming common copper corner costly " +
    "cotton county couple course cousin covers crater crayon create credit crisis critic crowds cruise crunch " +
    "crystal dagger damage danger dapper daring darken darted dating dazzle debate debris decade decant decide " +
    "decode deduct defeat defend define degree delete demand denied depart depend depict deploy deport deputy " +
    "doctor dollar domain donate donkey double doubts dragon dreams drifted driver drought drowned during " +
    "evenly evolve exceed except excess excite excuse exotic expand expect expert expire export expose " +
    "fault feared feather fellow female fierce figure filing finger finish firmly fiscal fitted fixing flakes " +
    "extend extent fabric facade facing factor fading failed fairly fallen falcon famine famous fasten father " +
    "feared feather fellow female fierce figure filing finger finish firmly fiscal fitted fixing flakes " +
    "flames flanks fleets flight flinch floating flooded floors fluent fluffy flying folded fondly forced forces " +
    "foresee forget forgot formal format former foster fought fourth fragile framed frames frantic freely freeze " +
    "friend fright fringe frozen frugal fuller fumble furrow fusion future gadget gained galaxy gallon gamble " +
    "garage garden garlic gather gauges gender gentle genius gently genuine gifted ginger glance glared glazes " +
    "gleams glides glimpsed gloomy golden golfer gopher gospel gossip gotten govern grades grains granite grants " +
    "grapes gravel gravity grazes grease greasy greedy greens grilled grinned grotto ground groups grower growth " +
    "guards guitar gutter hacked hammer hamper handed handle hangar hanging happens harbour hardly harmed hatred " +
    "haunted having hazard headed healed healthy hearing hearse heated heater heaven heavier helpful herald hidden " +
    "higher highly hinder hiring hitched hockey holder hollow homage homing honest hooked hoping hopping horizon " +
    "horned horror horses hotels hotter hounds housed houses however hugged humans humble hunger hunter hurdle " +
    "hurrah hurried hutch hybrids icicle ideals idling ignite ignore images immune impact impale impart impish " +
    "inches indeed infant infect inflate inform inhale injury inland inmate insect insist intact intend intent " +
    "invest invite iodine ironic island itself jacket jagged jammed jargon jaunty jealous jersey jewels jigsaw " +
    "jockey joined joints joking jolted journal journey joyous judged judges jumble jungle junior karate kernel " +
    "kettle keypad kidney killed kinder kindly kingdoms kisses kitten knacks knights knolls koala ladder ladles " +
    "lagoon lament landed language lantern lapses largest lashed lasting latest laughs launch lawyer layers layout " +
    "leader league learns leather ledger lesson lethal lettuce liable liaison liberty library lifted lights likely " +
    "limits linear linger linked lintel liquid listen litmus little lively living lizard loaded loaned locale " +
    "locate locked locust lofted lonely longer lookup loosest lordly lottery louder lounge lowest luggage lumber " +
    "luncheon lunches lurched lyrics machine madame magnet mailed mainly majestic mammal manage manger manual " +
    "marble margin marine marked market marlin marmot maroon martial marvel mascot masked masses master matron " +
    "matter mature meadow meager medals median meddle medium mellow melody melted member memoir mentor merely " +
    "merged meshes meteor method metric middle mighty migrate mildew mineral mingle minutes mirrored mischief " +
    "misery missing mission mister mitred mixture moaned mobile mocked models modern modest modify modules molded " +
    "moment monarch monkey months morale morbid morsel mosaic mosque mother motion motive mounds mounted mourned " +
    "mucous muddled muffin mugged mullet mumbled mundane murmurs museum muted mutual myriad nailed napkin narrow " +
    "nation native nature nearby nearly nebula needed nephew nerves nested neural neutral nineteen nobody nodded " +
    "noises nomads noodle normal nostril notable notice notify nought nourish novelty nowhere nozzle nuclear " +
    "nugget number numbly nursery nurture nutmeg oblige obtuse occupy occurs oceans octave offend offset omitted " +
    "onions online opaque opened openly operate opinion oppose optical option orange orchid ordeal ordered organs " +
    "orient origin ornate orphan ostrich ounces outlaw outlet output outset overall oyster packed packet padded " +
    "paddle pagoda painted palace pallet panels panics panther papaya parade parcels pardon parent parish parked " +
    "parody parlor parole parrot parted partly passed passing passion pastel pastor pastry patient patriot pauper " +
    "payment peanut pebble pelican pencil pending pennant people pepper perch period perish permit person petals " +
    "phantom phrase picked picnic pieces pigeon pillar pillow pirate pistil pitfall placed placid plague plains " +
    "planet planned plates played player please pledge plenty plight plotted plough plucked plunge plural poached " +
    "pocket poetic poetry poisoned ponder portal porter portion possum postal potato potent pounds poured poverty " +
    "powder praise prayed preach prefer prefix pretzel priest primal primer prince prison privet prized prizes " +
    "problem proceed profit prompt prongs proper prophet protect proven provide prudent pruned public puddle " +
    "puffin pulley pulpit punched pupils purest purify purple pursue puzzle python rabbit raccoon racing racism " +
    "radius raised raises rallies ramble random ranger ransom rapidly rarely rather rating rattan rattle ravens " +
    "ravine reached reader realms reason rebels rebuke recall recant recede recipe recital record recoup recover " +
    "recruit recycle reduce refine reform refuse refute regime region regret regular rejoice relate relief relish " +
    "remain remake remiss remote removal render rental repair repays repeat replay report rescue reserve reside " +
    "resign resist resort respect rested result resume retail retain retire retort retract return reunion reused " +
    "reveal revenge review revise revive revolt reward rhythm ribbon riddle rifles rigged ripple rising ritual " +
    "rivals rivers rivets roasted robber robust rocket rolled roller romance romped rooster rooted roster rotate " +
    "rounds routes routine rubber rubble rubric rudely rugged ruined rulers rumble runner runway sacred saddle " +
    "sadist safari safely safety sagged sailor saints salmon saloon salute salvage sample sandal sanded sanity " +
    "sapling satchel satire savage scaled scales scenic scheme school science scooter scored scour screen screws " +
    "script scroll sculpt sealed search season second secret sector secure sedans sedate seldom select seller " +
    "senate sensor sequel serene serial series sermon served severe sewers shabby shaded shades shadow shaken " +
    "shapes shared shares shattered shaving shelter shepherd shield shifty shipped shirts shiver shoddy shocked " +
    "shovels shower shrimp shrine shrink shrubs shrugs shutter shuttle sieges sienna sierra sighed sights signals " +
    "silence silent silica similar simple simply sinful singed singer single sister sitcom sixteen sketch skilled " +
    "skinny skirts skulls skyward slammed slander slanted sleepy sleeve slender slices slider slides slight slimed " +
    "slogans sluggish slumber smartly smashed smelly smiles smitten smoked smooth smudge snacks snails snakes " +
    "snappy snared sniper snitch snored snorts soaked soared soccer social socket sodium softer softly solder " +
    "solely solids solved solver somber sonata soothe sorbet sordid sorrow sought sounds spaced spades sparrow " +
    "spatula spawned spears special species speech speeds spells spheres spiders spilled spiral spirit splash " +
    "spoken sponge spoons sports spotty spread spring sprint sprout spruce square squash squint stable stacks " +
    "stadium staged stages stains stakes stalled stamps stance stands stanza staples stared starts starve stated " +
    "states static statue status staved steals steams steady steeps stellar stench sterile sticks sticky stifle " +
    "stigma stirred stitch stolen stones storms storied stoves strand strange strays streak stream street stress " +
    "stretch strict stride strife strike string stripe strips strive strokes stroll strong struck studio stupid " +
    "sturdy styles suburb subtle subway sudden suffer suites sulfur sullen summit summon sundae sunset superb " +
    "supper supply surely survey swallow swamps swanky sweater sweeps swimming swirl switch swooned symbol syntax " +
    "system tables tablet tackle tactics tailor talent talked taller tandem tangent tanker tanned tapered tariffs " +
    "tasked tattoo tavern teased temper temples tenant tended tender tennis tenure terrain terror tested thanks " +
    "thatch theater theory thirty thorns thorough thread threat thrive throne through thrown thumbs thumps thunder " +
    "turtles tutors twelve twenty unable uncles uncover unfair unfold unique unison united unites unless " +
    "toilets tomato tongue tonight tonsils topped torment tornado torrent tossed totals toucan touched tougher " +
    "tourist towels towers traced trader trails trains trance transit travel tread treats trends trench trendy " +
    "tribes trills triple triumph trouble trout trucks trumpet trusted truths tumble tundra tunnel turkey turmoil " +
    "unlike unlock untidy untied unusual unveil update upheld uphill upload uproar upward urgent usable useful " +
    "utmost vacancy vacant vacate vagrant valiant valley valued valves vanilla vanish vanity vapors varied varies " +
    "vector veggie vehicle vendor veneer verbal verdict verses vertex vessels viable victim victor videos viewer " +
    "village vinegar vintage violet violin virtue visas visual voiced voices volley volume voucher voyage wagged " +
    "wagons wailed waiting waived walker wallet walrus warmth warned warped warrior washes wasted wastes weather " +
    "weaver webbed wedded wedlock weekly weighed welcome welfare western wetted wheels whereas whether whilst " +
    "whipped whirls wholly wicked widely widest wilder willing willow window winner winter wisdom wisest wished " +
    "wishes witted wizard wolves wonder wooden woolen worker worlds worried worthy wounds wrapper wreckage wrench " +
    "wriggle wrinkled writer writes wrought yielding yogurt yonder zealous zebras zenith zephyr zigzag zipped " +
    "zipper zombie";

  const WORDS = new Set();
  RAW_WORDS.split(/\s+/).forEach((w) => {
    if (w && /^[a-z]+$/.test(w)) WORDS.add(w);
  });

  /* ── state ───────────────────────────────────────────── */
  let letters = []; // N letters
  let usedWords = new Set();
  let sel = []; // indices of chained tiles
  let cursor = -1; // keyboard cursor index (-1 hidden)
  let ink = INK_MAX;
  let score = 0;
  let wordsBanked = 0;
  let goalLevel = 1; // which goal we are chasing (1..LAST_LEVEL)
  let phase = "intro"; // intro | playing | paused | over
  let wonRun = false;
  let fx = []; // particles
  let toast = null; // { text, sub, t, color }
  let shake = 0;
  let hintPath = null;
  let hintTimer = 0;
  let lowWarned = false;
  let pointerPos = null;
  let dragging = false;

  /* ── audio ───────────────────────────────────────────── */
  let actx = null;
  let muted = false;

  function ensureAudio() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        actx = null;
      }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }

  function blip(freq, dur, type, vol, when) {
    if (muted || !actx) return;
    const t0 = actx.currentTime + (when || 0);
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol || 0.12, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.09));
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.09) + 0.02);
  }

  function sndTick(i) {
    blip(360 * Math.pow(1.059, Math.min(i, 14)), 0.06, "triangle", 0.08);
  }
  function sndOk() {
    blip(392, 0.09, "triangle", 0.11);
    blip(587, 0.12, "triangle", 0.1, 0.07);
  }
  function sndBig() {
    blip(392, 0.09, "triangle", 0.11);
    blip(523, 0.09, "triangle", 0.1, 0.06);
    blip(784, 0.16, "triangle", 0.1, 0.12);
  }
  function sndBad() {
    blip(130, 0.13, "square", 0.06);
  }
  function sndLevel() {
    blip(523, 0.09, "triangle", 0.1);
    blip(659, 0.09, "triangle", 0.1, 0.08);
    blip(880, 0.18, "triangle", 0.1, 0.16);
  }
  function sndOver(win) {
    if (win) {
      blip(523, 0.12, "triangle", 0.12);
      blip(784, 0.3, "triangle", 0.12, 0.12);
    } else {
      blip(330, 0.16, "triangle", 0.11);
      blip(220, 0.34, "triangle", 0.11, 0.14);
    }
  }

  /* ── layout / coordinates ────────────────────────────── */
  let viewScale = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = canvas.getBoundingClientRect();
    viewScale = rect.width / SIZE || 1;
  }

  function toLocal(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SIZE,
    };
  }

  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
    const col = clamp(Math.floor(x / CELL), 0, COLS - 1);
    const row = clamp(Math.floor(y / CELL), 0, ROWS - 1);
    return row * COLS + col;
  }

  function tileCenter(idx) {
    return {
      x: (idx % COLS) * CELL + CELL / 2,
      y: Math.floor(idx / COLS) * CELL + CELL / 2,
    };
  }

  /* ── grid generation ─────────────────────────────────── */
  function buildNeighbors() {
    const list = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const nb = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
              nb.push(nr * COLS + nc);
            }
          }
        }
        list.push(nb);
      }
    }
    return list;
  }
  const NEIGH = buildNeighbors();

  const VOWELS = "AEIOU";

  function newGrid() {
    let pool = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      pool = [];
      DICE.forEach((face) => {
        pool.push(face[Math.floor(Math.random() * face.length)]);
      });
      shuffle(pool);
      const vowels = pool.filter((ch) => VOWELS.includes(ch)).length;
      if (vowels >= 9 && vowels <= 17) {
        letters = pool.slice(0);
        return;
      }
    }
    // fallback: force-inject vowels
    while (pool.filter((c) => VOWELS.includes(c)).length < 9) {
      const at = Math.floor(Math.random() * N);
      pool[at] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
    }
    letters = pool.slice(0);
  }

  /* can `word` be traced on the current grid? */
  function hasPath(word) {
    const w = word.toUpperCase();
    if (w.length > N) return false;

    function dfs(pos, idx, seen) {
      if (letters[idx] !== w[pos]) return false;
      if (pos === w.length - 1) return true;
      seen[idx] = true;
      const nb = NEIGH[idx];
      for (let k = 0; k < nb.length; k++) {
        if (!seen[nb[k]] && dfs(pos + 1, nb[k], seen)) {
          seen[idx] = false;
          return true;
        }
      }
      seen[idx] = false;
      return false;
    }

    for (let i = 0; i < N; i++) {
      if (dfs(0, i, new Array(N).fill(false))) return true;
    }
    return false;
  }

  /* find a short playable word for the hint glow */
  function findHintWord() {
    const order = Object.keys(WORDS_SET_ORDER);
    for (let i = 0; i < 500; i++) {
      const w = order[Math.floor(Math.random() * order.length)];
      if (w.length >= MIN_LEN && w.length <= 5 && !usedWords.has(w)) {
        if (hasPath(w)) return w.toUpperCase();
      }
    }
    return null;
  }
  const WORDS_SET_ORDER = {}; // filled below (keys only, order irrelevant)

  /* ── scoring ─────────────────────────────────────────── */
  function wordPoints(word) {
    let pts = 0;
    for (let i = 0; i < word.length; i++) pts += LETTER_SCORES[word[i]] || 1;
    pts += (word.length - MIN_LEN) * 2;
    if (word.length >= 6) pts *= 2;
    return pts;
  }

  function currentGoal() {
    return GOAL_1 + (goalLevel - 1) * GOAL_STEP;
  }

  /* ── selection & commit ──────────────────────────────── */
  function selWord() {
    return sel.map((i) => letters[i]).join("");
  }

  function canAdd(idx) {
    if (sel.includes(idx)) return false;
    if (!sel.length) return true;
    return NEIGH[sel[sel.length - 1]].includes(idx);
  }

  function addTile(idx) {
    sel.push(idx);
    hintTimer = 0;
    sndTick(sel.length - 1);
    updateWordline("");
  }

  function undoLast() {
    if (sel.length) {
      sel.pop();
      updateWordline("");
    }
  }

  function clearSel() {
    sel.length = 0;
    updateWordline("");
  }

  function stepCost(lenSoFar) {
    return STEP_BASE + STEP_SLOPE * lenSoFar;
  }

  function payStepCost() {
    // called once per added tile (including the first)
    ink -= stepCost(sel.length - 1);
  }

  function tryCommit() {
    if (phase !== "playing" || !sel.length) return;
    const w = selWord().toLowerCase();
    const L = w.length;

    function fail(msg) {
      showToast(msg, "", "#a33327");
      shake = 5;
      sndBad();
      clearSel();
    }

    if (L < MIN_LEN) return fail("Too short — 3 letters minimum");
    if (usedWords.has(w)) return fail("Already banked");
    if (!WORDS.has(w)) return fail("Not in the lexicon");

    const pts = wordPoints(w.toUpperCase());
    score += pts;
    wordsBanked += 1;
    usedWords.add(w);

    const gain = Math.min(BANK_CAP, BANK_BASE + BANK_PER_LETTER * L);
    ink = Math.min(INK_MAX, ink + gain);
    sndOk();
    if (L >= 5 || pts >= 20) sndBig();

    const last = tileCenter(sel[sel.length - 1]);
    spawnBurst(last.x, last.y, L >= 5 ? 16 : 10, "#b98a2e");
    showToast(
      w.toUpperCase(),
      "+" + pts + " · +" + Math.round(gain) + " ink",
      "#2e7d4f",
    );

    clearSel();

    if (score >= currentGoal()) {
      if (goalLevel >= LAST_LEVEL) {
        gameOver(true);
        return;
      }
      goalLevel += 1;
      ink = Math.min(INK_MAX, ink + LEVEL_INK_BONUS);
      sndLevel();
      showToast(
        "FRESH PAGE",
        "goal " + currentGoal() + " · +" + LEVEL_INK_BONUS + " ink",
        "#1d2440",
      );
    }
  }

  /* ── effects ─────────────────────────────────────────── */
  function spawnBurst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 120;
      fx.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 30,
        life: 0.55 + Math.random() * 0.35,
        age: 0,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function showToast(text, sub, color) {
    toast = { text, sub, color, t: 1.5 };
  }

  function updateFx(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 22);
    if (toast) {
      toast.t -= dt;
      if (toast.t <= 0) toast = null;
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i];
      p.age += dt;
      if (p.age >= p.life) {
        fx.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt;
    }
  }

  /* ── HUD / wordline ──────────────────────────────────── */
  function updateWordline(statusClass) {
    if (!sel.length) {
      if (statusClass !== "keep") {
        wordline.className = "";
        wordline.innerHTML = "&nbsp;";
      }
      return;
    }
    const w = selWord();
    const pts = wordPoints(w);
    wordline.className = statusClass || "";
    wordline.textContent = w;
    if (pts) {
      const spanPts = document.createElement("span");
      spanPts.className = "pts";
      spanPts.textContent = pts + " pt" + (pts === 1 ? "" : "s");
      wordline.appendChild(spanPts);
    }
  }

  function updateHud() {
    hudScore.textContent = String(score);
    hudWords.textContent = String(wordsBanked);
    hudGoal.textContent = String(currentGoal());
    const pct = clamp(ink / INK_MAX, 0, 1);
    hudInkfill.style.width = (pct * 100).toFixed(1) + "%";
    hudInkfill.className = pct < 0.25 ? "low" : "";
  }

  /* ── game flow ───────────────────────────────────────── */
  function newGridSafe() {
    newGrid();
  }

  function startRun() {
    newGridSafe();
    usedWords = new Set();
    sel.length = 0;
    ink = INK_MAX;
    score = 0;
    wordsBanked = 0;
    goalLevel = 1;
    wonRun = false;
    fx.length = 0;
    toast = null;
    shake = 0;
    hintPath = null;
    hintTimer = 0;
    lowWarned = false;
    cursor = -1;
    phase = "playing";
    overlay.hidden = true;
    btnPause.textContent = "Pause (Esc)";
    updateWordline("");
    updateHud();
  }

  function gameOver(win) {
    phase = "over";
    wonRun = win;
    clearSel();
    sndOver(win);
    let best = { w: "", p: 0 };
    usedWords.forEach((w) => {
      const p = wordPoints(w.toUpperCase());
      if (p > best.p) best = { w, p };
    });
    ovTitle.textContent = win ? "Folio Complete" : "The Ink Ran Dry";
    ovText.innerHTML =
      (win
        ? "Three pages cleared with ink to spare."
        : "You reached page " + goalLevel + " of " + LAST_LEVEL + ".") +
      "<br><strong>" +
      score +
      "</strong> points · <strong>" +
      wordsBanked +
      "</strong> words" +
      (best.w
        ? "<br>best word: <strong>" +
          best.w.toUpperCase() +
          "</strong> (" +
          best.p +
          ")"
        : "");
    ovBtn.textContent = "Play again";
    overlay.hidden = false;
  }

  function showIntro() {
    phase = "intro";
    ovTitle.textContent = "Inkfall";
    ovText.innerHTML =
      "Drag through neighbouring letters to spell words of three or more tiles.<br>" +
      "Every step costs a drop of ink; every word you bank refills the well — but " +
      "the ink dries on its own, so keep hunting.<br>Clear three score pages before the pen scratches bottom.";
    ovBtn.textContent = "Begin";
    overlay.hidden = false;
  }

  function togglePause(force) {
    if (phase === "playing" || force === true) {
      if (phase !== "playing") return;
      phase = "paused";
      ovTitle.textContent = "Paused";
      ovText.textContent = "The ink is not drying while you rest.";
      ovBtn.textContent = "Resume";
      overlay.hidden = false;
      btnPause.textContent = "Resume (Esc)";
    } else if (phase === "paused") {
      phase = "playing";
      overlay.hidden = true;
      btnPause.textContent = "Pause (Esc)";
    }
  }

  function blurButtons() {
    // keep Space/Enter from re-triggering a focused control during play
    [ovBtn, btnPause, btnSound, btnRestart].forEach((b) => b.blur());
  }

  ovBtn.addEventListener("click", () => {
    ensureAudio();
    blurButtons();
    if (phase === "intro" || phase === "over") startRun();
    else if (phase === "paused") togglePause();
  });
  btnPause.addEventListener("click", () => {
    ensureAudio();
    blurButtons();
    togglePause();
  });
  btnSound.addEventListener("click", () => {
    ensureAudio();
    blurButtons();
    muted = !muted;
    btnSound.textContent = muted ? "Sound: off (M)" : "Sound: on (M)";
  });
  btnRestart.addEventListener("click", () => {
    ensureAudio();
    blurButtons();
    startRun();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") togglePause();
  });

  /* ── input: pointer ──────────────────────────────────── */
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    if (phase !== "playing") return;
    dragging = true;
    cursor = -1;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    const p = toLocal(e);
    pointerPos = p;
    const idx = cellAt(p.x, p.y);
    if (idx >= 0) {
      clearSel();
      addTile(idx);
      payStepCost();
      updateHud();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || phase !== "playing") return;
    const p = toLocal(e);
    pointerPos = p;
    const idx = cellAt(p.x, p.y);
    if (idx < 0) return;
    if (canAdd(idx)) {
      addTile(idx);
      payStepCost();
      updateHud();
    } else if (sel.length >= 2 && idx === sel[sel.length - 2]) {
      undoLast(); // backtrack
    }
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    pointerPos = null;
    tryCommit();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* ── input: keyboard ─────────────────────────────────── */
  function moveCursor(dr, dc) {
    if (phase !== "playing") return;
    if (cursor < 0) cursor = 0;
    else {
      const r = clamp(Math.floor(cursor / COLS) + dr, 0, ROWS - 1);
      const c = clamp((cursor % COLS) + dc, 0, COLS - 1);
      cursor = r * COLS + c;
    }
  }

  function keyboardLetter(ch) {
    if (phase !== "playing") return;
    const target = ch.toUpperCase();
    let bestIdx = -1;
    let bestDist = Infinity;
    const ref = cursor >= 0 ? cursor : sel.length ? sel[sel.length - 1] : 0;
    const rc = tileCenter(ref);
    for (let i = 0; i < N; i++) {
      if (letters[i] !== target || sel.includes(i)) continue;
      if (sel.length && !NEIGH[sel[sel.length - 1]].includes(i)) continue;
      const tc = tileCenter(i);
      const d = Math.hypot(tc.x - rc.x, tc.y - rc.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      addTile(bestIdx);
      payStepCost();
      updateHud();
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    /* letters type only while playing, so P/M/R never hijack the alphabet */
    if (/^[a-z]$/.test(k) && phase === "playing") {
      ensureAudio();
      keyboardLetter(k);
      return;
    }
    switch (k) {
      case "arrowup":
        e.preventDefault();
        moveCursor(-1, 0);
        break;
      case "arrowdown":
        e.preventDefault();
        moveCursor(1, 0);
        break;
      case "arrowleft":
        e.preventDefault();
        moveCursor(0, -1);
        break;
      case "arrowright":
        e.preventDefault();
        moveCursor(0, 1);
        break;
      case "enter":
      case " ":
        e.preventDefault();
        ensureAudio();
        if (phase === "intro" || phase === "over") startRun();
        else if (phase === "paused") togglePause();
        else tryCommit();
        break;
      case "backspace":
        e.preventDefault();
        if (phase === "playing") {
          undoLast();
          updateHud();
        }
        break;
      case "escape":
        ensureAudio();
        if (phase === "playing") {
          if (sel.length) clearSel();
          else togglePause();
        } else if (phase === "paused") {
          togglePause();
        } else {
          startRun();
        }
        break;
      case "r":
        /* restart from overlays and pause; during play R is just a letter */
        if (phase !== "playing") {
          ensureAudio();
          startRun();
        }
        break;
    }
  });

  /* ── rendering ───────────────────────────────────────── */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBoard(now) {
    const wob = shake > 0 ? shake : 0;
    ctx.save();
    if (wob) {
      ctx.translate((Math.random() - 0.5) * wob, (Math.random() - 0.5) * wob);
    }

    // paper
    ctx.fillStyle = "#fbf5e6";
    ctx.fillRect(-8, -8, SIZE + 16, SIZE + 16);

    // frame
    ctx.strokeStyle = "rgba(29,36,64,0.28)";
    ctx.lineWidth = 2;
    roundRect(5, 5, SIZE - 10, SIZE - 10, 12);
    ctx.stroke();

    // hint glow
    if (hintPath) {
      const pulse = 0.35 + 0.25 * Math.sin(now * 5);
      ctx.fillStyle = "rgba(185,138,46," + pulse.toFixed(3) + ")";
      hintPath.forEach((idx) => {
        const c = tileCenter(idx);
        roundRect(
          c.x - CELL / 2 + 4,
          c.y - CELL / 2 + 4,
          CELL - 8,
          CELL - 8,
          10,
        );
        ctx.fill();
      });
    }

    // chain line
    if (sel.length) {
      ctx.strokeStyle = "rgba(29,36,64,0.45)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const c0 = tileCenter(sel[0]);
      ctx.moveTo(c0.x, c0.y);
      for (let i = 1; i < sel.length; i++) {
        const ci = tileCenter(sel[i]);
        ctx.lineTo(ci.x, ci.y);
      }
      if (dragging && pointerPos) ctx.lineTo(pointerPos.x, pointerPos.y);
      ctx.stroke();

      // leading segment to finger/cursor
      if (dragging && pointerPos) {
        const cl = tileCenter(sel[sel.length - 1]);
        const d = Math.hypot(pointerPos.x - cl.x, pointerPos.y - cl.y);
        if (d > 4) {
          ctx.strokeStyle = "rgba(29,36,64,0.2)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(cl.x, cl.y);
          ctx.lineTo(pointerPos.x, pointerPos.y);
          ctx.stroke();
        }
      }
    }

    // tiles
    for (let i = 0; i < N; i++) {
      const cx = (i % COLS) * CELL;
      const cy = Math.floor(i / COLS) * CELL;
      const picked = sel.includes(i);
      const inset = picked ? 2 : 5;
      ctx.save();
      if (picked) {
        ctx.shadowColor = "rgba(29,36,64,0.55)";
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = picked ? "#1d2440" : "#fffdf4";
      roundRect(cx + inset, cy + inset, CELL - inset * 2, CELL - inset * 2, 9);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = picked ? "#1d2440" : "rgba(29,36,64,0.22)";
      ctx.lineWidth = 1.5;
      roundRect(cx + inset, cy + inset, CELL - inset * 2, CELL - inset * 2, 9);
      ctx.stroke();

      // letter
      ctx.fillStyle = picked ? "#f3ead8" : "#1d2440";
      ctx.font = "bold 27px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letters[i] || "", cx + CELL / 2, cy + CELL / 2 - 3);

      // subscript points
      const pv = LETTER_SCORES[letters[i]] || 0;
      ctx.font = "10px Georgia, serif";
      ctx.fillStyle = picked ? "rgba(243,234,216,0.7)" : "rgba(29,36,64,0.42)";
      ctx.textAlign = "right";
      ctx.fillText(String(pv), cx + CELL - 9, cy + CELL - 11);

      // keyboard cursor
      if (i === cursor && phase === "playing") {
        ctx.strokeStyle = "#a33327";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        roundRect(cx + 2, cy + 2, CELL - 4, CELL - 4, 9);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // particles
    fx.forEach((p) => {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a + 0.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // toast
    if (toast) {
      const a = Math.min(1, toast.t / 0.4);
      ctx.globalAlpha = a;
      ctx.font = "bold 30px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(251,245,230,0.9)";
      ctx.strokeText(toast.text, SIZE / 2, 56);
      ctx.fillStyle = toast.color;
      ctx.fillText(toast.text, SIZE / 2, 56);
      if (toast.sub) {
        ctx.font = "15px Georgia, serif";
        ctx.strokeText(toast.sub, SIZE / 2, 86);
        ctx.fillStyle = "#4a5378";
        ctx.fillText(toast.sub, SIZE / 2, 86);
      }
      ctx.globalAlpha = 1;
    }

    // in-canvas ink gauge
    const pct = clamp(ink / INK_MAX, 0, 1);
    ctx.fillStyle = "rgba(29,36,64,0.12)";
    roundRect(8, SIZE - 12, SIZE - 16, 6, 3);
    ctx.fill();
    ctx.fillStyle = pct < 0.25 ? "#a33327" : "#1d2440";
    if (pct > 0.01) {
      roundRect(8, SIZE - 12, (SIZE - 16) * pct, 6, 3);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ── main loop ───────────────────────────────────────── */
  let lastFrame = performance.now();

  function frame(nowMs) {
    const nowSec = nowMs / 1000;
    let dt = nowSec - lastFrame;
    lastFrame = nowSec;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    if (phase === "playing") {
      ink -= INK_DECAY_PER_SEC * dt;

      if (ink <= 0) {
        ink = 0;
        updateHud();
        gameOver(false);
      } else {
        if (ink < 20 && !lowWarned) {
          lowWarned = true;
          showToast("INK LOW", "bank words to refill", "#a33327");
          sndBad();
        }
        if (ink >= 30) lowWarned = false;

        hintTimer += dt;
        if (hintTimer > 9 && !hintPath) {
          const w = findHintWord();
          if (w) {
            hintPath = tracePath(w);
            hintTimer = 0;
            setTimeout(() => {
              hintPath = null;
            }, 2600);
          } else {
            hintTimer = 6; // retry sooner-ish
          }
        }
      }
      updateHud();
    }

    updateFx(dt);
    drawBoard(nowSec);
    requestAnimationFrame(frame);
  }

  /* rebuild the actual path for the hint word (for the glow) */
  function tracePath(word) {
    const w = word.toUpperCase();
    const path = [];

    function dfs(pos, idx, seen) {
      if (letters[idx] !== w[pos]) return false;
      path.push(idx);
      if (pos === w.length - 1) return true;
      seen[idx] = true;
      const nb = NEIGH[idx];
      for (let k = 0; k < nb.length; k++) {
        if (!seen[nb[k]] && dfs(pos + 1, nb[k], seen)) return true;
      }
      seen[idx] = false;
      path.pop();
      return false;
    }

    for (let i = 0; i < N; i++) {
      if (dfs(0, i, new Array(N).fill(false))) return path.slice();
    }
    return null;
  }

  /* ── init ────────────────────────────────────────────── */
  // fill the hint-order table (any iteration order of the Set works)
  let wi = 0;
  WORDS.forEach((w) => {
    WORDS_SET_ORDER[wi++] = w;
  });

  window.addEventListener("resize", resize);
  resize();
  newGridSafe();
  updateHud();
  showIntro();
  requestAnimationFrame(frame);

  /* headless-test hook: only active when the page URL carries #debug */
  if (/debug/.test(window.location.hash)) {
    window.__inkfall = {
      phase: () => phase,
      ink: () => ink,
      score: () => score,
      words: () => wordsBanked,
      goal: () => goalLevel,
      sel: () => sel.slice(),
      letters: () => letters.slice(),
      used: () => Array.from(usedWords),
      hasPath,
      startRun,
      gameOver,
      commit: tryCommit,
      setInk: (v) => {
        ink = v;
        updateHud();
      },
    };
  }
})();
