# Galactic races, crawler races and dungeon races — facts tagged by first-reveal book.
from model import E

RACES = [
# ---------------- Galactic / off-world species ----------------
E("Kua-Tin", "Alien race", [
  (1, "Fish-like humanoids, the dominant species of the Borant System and principal owners of the Borant Corporation, which runs Earth's crawl. Their ruling party, the Bloom (\"the Party\"), is ultra-nationalist."),
  (1, "Zev, Borant's communications rep for Carl and Donut, wears a water-filled glass helmet."),
  (4, "A kua-tin underground is stirring; the system is unstable."),
  (5, "Others call them \"mudskippers.\""),
  (7, "Mukta and Cascadia (the season's showrunner) are kua-tin."),
 ], rel=[(1, "Zev."), (3, "Loita."), (7, "Mukta, Cascadia.")], aliases={1: ["kua-tin"], 5: ["mudskipper", "mudskippers"]}),

E("Valtay", [(1, "Corporation"), (2, "Alien race")], [
  (1, "The Valtay Corporation makes gear Carl finds (shields, pistols, tunnel relays)."),
  (2, "The pop singer Manasa's corpse is kept performing by the Valtay Corporation. The Valtay and the Skull Empire are allies (for now)."),
  (3, "The Valtay Corporation sponsors Carl. When the Skull Empire's assassination attempt killed Manasa instead, the Valtay reportedly killed Prince Maestro in retaliation."),
  (4, "The Valtay are gondii: parasitic worms. Now at odds with the Skull Empire."),
  (5, "They blew up Queen Consort Ugloo's yacht over Manasa's death. Carl loses the Valtay sponsorship. A Syndicate ruling grants the Valtay Corporation majority control of the Borant Corporation, and with it the crawl."),
  (7, "Gondii worms can move into any dead body, take it over and learn its memories."),
  (8, "The rogue AI blows up Valtay-leased manufacturing facilities; an Emperator of the Valtay fleet arrives with a system-busting bomb."),
 ], rel=[(3, "Former sponsor of Carl."), (5, "Majority owner of Borant.")], aliases={4: ["Gondii", "gondii"], 7: ["Valtay worm"]}),

E("Saccathian", "Alien race", [
  (2, "Tentacle-faced people, called \"Sacs.\" Princess D'nadia of the Prism is one."),
  (7, "The Prism's Faction Wars scout was a Saccathian prince, one of D'nadia's relatives."),
 ], rel=[(2, "Prism Kingdom: D'nadia.")], aliases={2: ["Sacs", "Saccathians"]}),

E("Nullian", "Alien race", [
  (2, "Big-headed aliens Earth called \"the Grays\"; others call them nasty perverts and blame them for the probe stories."),
  (4, "Whole systems refuse entry to the Null despite it being illegal."),
  (5, "Usually just called \"the Null.\""),
  (6, "Nullians capture and ride Nightgaunts, peaceful semi-intelligent bat creatures from a Nullian world."),
  (8, "Carl's lawyer Quasar is a Nullian."),
 ], rel=[(8, "Quasar (Carl's attorney).")], aliases={2: ["Grays", "The Grays", "the Null"]}),

E("Grixist", "Alien race", [
  (6, "Alien race of Huanxin Jinx, CEO of Icon Industries (\"of the Grixist Swarm\")."),
 ], rel=[(6, "Huanxin Jinx.")], aliases={6: ["Grixist Swarm"]}),

E("Soother", "Alien race", [
  (2, "Tall, jello-mold, blob-like aliens with large saucer eyes and upward-facing mouths; often TV hosts."),
  (4, "One of the most common alien types; a male soother sponsors a goddess."),
  (8, "Soothers originally proposed eradicating all the seeded worlds."),
 ], aliases={2: ["soothers"]}),

E("Quokka", "Alien race", [
  (2, "Carl and Donut are booked on the show Danger Zone with Ripper Wonton."),
  (5, "Ripper Wonton is a fuzzy quokka."),
 ], rel=[(5, "Ripper Wonton.")]),

E("Orc", "Alien race", [
  (1, "Galactic orcs. \"If the Orcish Supremacy is a child with a lemonade stand, the Skull Empire is the Wal-Mart corporation.\" Tusklings appear as mobs."),
  (2, "Carl insults the orc king and his son's ship lasers the production trailer from orbit."),
  (3, "King Rust leads the Skull Empire."),
  (6, "Skull Empire royals are wild-boar-looking orcs."),
 ], rel=[(3, "Skull Empire royals: King Rust, Maestro, Stalwart, Formidable.")], aliases={1: ["orcs", "Orcish Supremacy", "Tuskling"]}),

E("Crest", "Alien race", [
  (5, "A hunter race on the 6th floor."),
  (6, "A human race with no eyebrows. Rosetta Thag is a Crest."),
 ], rel=[(6, "Rosetta Thag.")]),

E("Caprid", "Alien race", [
  (2, "Walking, talking goat people. Prepotente is a caprid crawler."),
  (3, "The Plenty are a caprid civilization; the 4th floor's Pooka caricature them in a \"racist political cartoon.\""),
  (5, "The Plenty invented the tunneling system and supposedly work with the Apothecary. A mysterious caprid liaison seems to be working with the Skull Empire to get Carl killed. The Midnight Epicure, \"the Caprid Who Devours the Sky,\" is a fable used to scare children."),
  (6, "A caprid is among Carl's sponsors."),
 ], rel=[(2, "Prepotente.")], aliases={2: ["caprids"], 3: ["Plenty", "the Plenty"]}),

E("Krakaren", [(1, "Dungeon boss"), (3, "Alien race / collective")], [
  (1, "Krakaren Prime is a tentacled dungeon boss; for every one killed, she births two more."),
  (3, "Mordecai: the Krakaren is a real collective mind spreading through the universe; a better translation of its name is \"the Apothecary.\" The 4th floor's drug-making Krakaren boroughs are a political caricature."),
  (5, "The Apothecary becomes Carl's new sponsor, and sponsors Katia too."),
  (6, "Apothecary residuals were waiting on Earth (Agatha took over one's body)."),
  (7, "The Apothecary \"sponsors half the dungeon\"; it is a trans-dimensional entity."),
 ], rel=[(5, "Sponsor of Carl and Katia; partnered with the Plenty.")], aliases={1: ["Krakaren Prime"], 5: ["Apothecary", "the Apothecary"]}),

E("Mantis", "Alien race", [
  (5, "Insectoid mantis people: the Dark Hive (Circe Took, Vrah) and other mantis hunters are on the 6th floor."),
  (6, "The Burrowers, a mantis-led Faction Wars team, quit. Macro AIs are built in a facility in the Mantis system."),
  (8, "The rogue AI destroys an entire Mantis system."),
 ], rel=[(5, "Circe Took, Vrah, Hunter Xindy.")], aliases={5: ["Dark Hive", "mantises"], 6: ["Burrowers", "Mantis system"]}),

E("Sai", "Alien race", [
  (6, "Armored rhino-like guards, former firefighters made nearly extinct by firefighting in a war zone; Walter is one. They guard part of the Desperado Club."),
  (7, "After the club's reorganization, surviving Sai like Toyotomi became mercenaries."),
 ], rel=[(6, "Walter."), (7, "Toyotomi.")], aliases={6: ["Armored Sai"]}),

E("Dreadnought", "Alien race", [
  (5, "Haxor the Destroyer is one. The Dreadnought Clan quit Faction Wars after Larracos flooded."),
  (7, "A Dreadnought wears a Viceroy mask on the 9th floor."),
 ], aliases={5: ["Dreadnoughts"], 7: ["Dreadnaught"]}),

E("Viceroy", "Alien race / faction", [
  (7, "Masked outworlders. Architect Houston, masked Viceroy leader of team Madness, plays in Faction Wars; a past Viceroy team summoned Mazu, who razed the buildings around Larracos."),
 ], rel=[(7, "Architect Houston.")], aliases={7: ["Viceroys"]}),

E("Gnoll", "Alien/dungeon race", [
  (1, "Dog-like people; Carl finds Shade Gnoll Riot Forces gear."),
  (3, "Shade Gnolls and Gnoll Transit Security appear on the 4th floor."),
  (7, "Gnolls also serve as Faction Wars soldiers (e.g. Hunger Hammy)."),
 ], aliases={1: ["Shade Gnoll"], 2: ["Gnolls"]}),

E("Lepus", "Alien race", [
  (3, "One of the most widespread semi-intelligent species; a Skull Empire warlord nearly ate one planet's Lepus to extinction (Lepus hasenpfeffer). The blind Cornet is a devolved Lepus."),
 ]),

E("Dromedarian", "Alien race", [
  (4, "Camel people: Dromedarians can go two months without water. On the 5th floor they and the Bactrian camels are locked in a conflict involving the Dirigible Gnomes. Clay is a Dromedarian."),
  (7, "Both camel peoples serve as Faction Wars troops."),
 ], rel=[(4, "Clay.")], aliases={4: ["Dromedarians", "Bactrian", "Bactrians"]}),

E("Changeling", "Race (dungeon & galactic)", [
  (1, "Shapeshifters. Mordecai was born a skyfowl but became a changeling on floor 3 of his own crawl."),
  (2, "A changeling can become any race it has physically touched, with caveats."),
  (4, "On the 5th floor: Juice Box (a changeling prostitute Louis \"awakens\"), and the changeling principal Svern."),
  (7, "High-level changeling NPCs run hot (you can track them by body temperature). Juice Box becomes an NPC warlord."),
 ], rel=[(1, "Mordecai."), (4, "Juice Box, Svern."), (6, "Ruby.")], aliases={1: ["changelings"], 4: ["Changeling Principal"]}),

E("Skyfowl", "Race (galactic & dungeon)", [
  (1, "Eagle-like bird people; Mordecai was born one."),
  (2, "Skyfowl NPCs live on the 3rd floor (Carl \"owns\" a medium skyfowl town); they insist they never cheat customers. A doomsday elf sect protects them, tied to Scolopendra's nine-tier attack."),
  (6, "91% of skyfowl crawlers stay skyfowl, like Mordecai's brother Uzzi and their friend Hold Steady. Skyfowl seasons typically end with a 9th-floor slaughter."),
  (7, "Justice Light is a skyfowl."),
  (8, "A skyfowl, not Theia, is found in Theia's temple; Justice Light breaks the Nothing."),
 ], rel=[(1, "Mordecai."), (6, "Uzzi, Hold Steady."), (7, "Justice Light.")]),

E("Pterolykos", "Race", [
  (3, "A crawler race seen in the rankings."),
  (6, "Wolf-headed race. Chaco the Song Bard is a pterolykos."),
 ], rel=[(6, "Chaco.")]),

E("Bopca", "Dungeon race", [
  (1, "Bopca Protectors: magical, gnome-like creatures who exist solely to watch over safe rooms (Tally, Sebastian)."),
  (2, "Gordo is one."),
  (3, "Talking a Bopca down gives extra skill experience."),
 ], aliases={1: ["Bopca Protector", "Bopca Protectors"]}),

E("Crocodilian", "Race", [
  (2, "Florin's crawler race; Clarabelle is one."),
  (3, "Clarabelle is the Desperado Club's bouncer."),
  (4, "They triple the effectiveness of buffs gained from eating creatures."),
 ], rel=[(2, "Florin, Clarabelle.")]),

E("Tigran", "Race", [
  (3, "Bautista's crawler race."),
  (8, "Tiger people, stereotyped as angry, emotional, strong and fiercely loyal. Nico is one."),
 ], rel=[(3, "Daniel Bautista."), (8, "Nico.")]),

E("Naga", "Race", [
  (2, "Snake people. 250+ cycles ago the Blood Sultanate of the Naga ran the first crawl ever to lose money. Manasa appears as a Naga but isn't really one."),
  (4, "Eva Sigrid is half Nagini, half orc."),
  (7, "On the 9th floor, Donut and Katia can't leave until all the Naga are dead. Naga contracts change the rules on you."),
  (8, "Naga law lets a royal widow claim her husband's assassin as her new husband (Widow's Rights)."),
 ], aliases={2: ["Nagas"], 4: ["Half Nagini"]}),

E("Lajabless", "Race", [
  (2, "Lucia Mar's crawler race: half the day a beautiful woman, half in a strength-based, skull-faced form."),
 ], rel=[(2, "Lucia Mar.")]),

E("Changbi", "Race", [
  (3, "Li Na's demonic crawler race."),
  (5, "Lets her see whether anyone is affiliated with a god."),
  (8, "A Changbi can't worship a god."),
 ], rel=[(3, "Li Na.")]),

E("Nodling", "Race", [
  (3, "Dmitri and Maxim Popov share a nodling body."),
  (5, "A nodling's extra heads give an extra life. Signet's tattoo was a three-headed nodling."),
  (7, "That nodling died and split into three ogres."),
 ], rel=[(3, "Popov brothers.")], aliases={3: ["nodlings"]}),

E("Primal", "Race", [
  (2, "Carl's crawler race, picked from the very bottom of the menu. A Primal crawler from an old season was shown with white, wispy angel wings and a lightning sword."),
  (7, "Mordecai suspects Carl's success is the communal nature of the Primal race."),
 ], rel=[(2, "Carl.")]),

E("Primal Engine", "Galactic tech", [
  (6, "Many planets have a Primal Engine at their core. Macro AIs, built in the Mantis system, can only be installed into Primal Engines, to control the planet once it matures."),
  (8, "When the macro AI is installed into a planet's Primal Engine, the planet's NPCs \"wake up.\" The AI has \"gone Primal.\""),
 ]),

E("Frost Maiden", "Race", [(2, "Elle McGib's crawler race (class Blizzardmancer).") , (5, "Elle's class becomes Tundra Princess.")], rel=[(2, "Elle McGib.")]),

E("Doppelganger", "Race", [(2, "Katia Grim's crawler race: she can reshape her body."), (3, "Her class: Monster Truck Driver.")], rel=[(2, "Katia Grim.")]),

E("Amazonian", "Race", [(2, "Hekla's crawler race (Shieldmaiden).")], rel=[(2, "Hekla.")]),

E("Residual", "Being", [
  (6, "Agents planted on a world before its crawl. Paulie (real name Goff), living in a human body, is a Residual; Agatha (Agent number 22) is \"a different kind.\" Apothecary residuals were waiting on Earth."),
  (7, "\"I think the mudskippers call us 'Residuals.'\" Agatha is the rarer kind, more in line with the Nebulars."),
 ], rel=[(6, "Paulie/Goff, Agatha.")], aliases={6: ["Residuals"]}),

# ---------------- Dungeon races ----------------
E("High Elves", "Dungeon race", [
  (2, "Ruling elves of the Hunting Grounds who hunt any mongrel child of their late king (Signet is one)."),
  (3, "They enslaved the hill giants. The vulture goddess blamed the male-dominated high elf court when her worshippers strayed."),
  (5, "On the 6th floor: they executed the Pocket Kuma and drove out the Chee. Queen Imogen rules. Signet's father was the high elf king."),
  (6, "Imogen helped kill Signet's mother."),
 ], rel=[(5, "Queen Imogen; Signet (half).")], aliases={2: ["High Elf"]}),

E("Naiad", "Dungeon race", [
  (2, "Water people whose Confederacy tends to drown outsiders. Signet is half naiad, half high elf."),
  (4, "Lika is a half-naiad trobairitz."),
  (5, "A coup killed Signet's mother and got Signet banished. Samantha is half-naiad."),
 ], rel=[(2, "Signet."), (4, "Lika.")], aliases={2: ["Naiad Confederacy"]}),

E("Grulke", "Dungeon race", [(3, "A rare, militaristic race of toad warriors (\"Don't ever call a real Grulke a frog\"); one of Mordecai's forms.")], rel=[(3, "Mordecai (form).")]),

E("Ursine", "Dungeon race", [
  (5, "Pious bear people of the Hunting Grounds (\"49% bear, 51% racist uncle\"); neighbors and rivals of the bugbears."),
  (7, "Kiwi was born an Ursine."),
 ]),

E("Bugbear", "Race", [
  (4, "Shamus Chaindrive was a bugbear treasure hunter."),
  (5, "One of the few races not wiped out by Scolopendra's nine-tier attack; common in the Kapok district. Rivals of the Ursine."),
 ], aliases={5: ["Bugbears"]}),

E("Dirigible Gnome", "Dungeon race", [
  (3, "The Dirigible Gnome Wasteland Fortress is one option for the 5th floor."),
  (4, "Airship gnomes; Commandant Kane runs the Dreadnaught Wasteland; his uncle Wynne is in chains."),
 ], rel=[(4, "Kane, Wynne.")], aliases={4: ["Dirigible Gnomes"]}),

E("Semeru Dwarf", "Dungeon race", [
  (4, "Dwarves who built Larracos, digging down toward the Celestials who live below them."),
  (5, "They dug their 9th-floor city too deep and lost everything."),
  (6, "They worship a single goddess who appears near the end of the battles outside Larracos."),
  (7, "Usually seen as a drunk, defeated people who just keep the castle clean."),
 ], aliases={4: ["Semeru"], 5: ["Semeru Dwarves"]}),

E("Hobgoblin", "Race", [
  (1, "Source of Carl's favourite explosives: hobgoblin pus, hobgoblin dynamite, detonators."),
  (2, "A crawler race option: big, muscular goblins. Hob-lobbers are their grenades."),
  (6, "Pustule the hobgoblin sells smoke curtains in the Desperado Club."),
 ], aliases={1: ["hobgoblins"]}),

E("Porsuk", "Dungeon race", [(6, "Badger-headed race; all the Desperado Club bartenders are Porsuk.")]),

E("Hobbledehoy", "Dungeon race", [(6, "Pater Coal, High Cleric Supreme of Emberus, is a Hobbledehoy.")], rel=[(6, "Pater Coal.")]),

E("Mantaur", "Dungeon race", [
  (3, "\"Half human, and, uh, half human\" 'taurs, engineered to be Tangle Train engineers (Gore-Gore)."),
  (6, "Mantaurs guard Club Vanquisher entrances."),
  (8, "Lady Mantaurs (Genesis) don't worship Grull like the males."),
 ], aliases={3: ["ManTauR"], 8: ["Lady Mantaur"]}),

E("Grapple", "Dungeon race", [(3, "Quarter-giant slave race bred by the High Elves from enslaved hill giants and large humans.")]),

E("Ifrit", "Demon", [(6, "Demons attuned to sin (\"Where there is sin, there are Ifrit\"). Damascus Steel is one.")]),

E("Bloodlust Sprite", "Dungeon race", [
  (3, "One of the rarest, deadliest sprites; Astrid is one."),
  (5, "Adepts of cardiovascular magic."),
  (6, "Astrid is Assistant Manager of the Desperado Club."),
 ], rel=[(3, "Astrid.")]),

E("Rage Elemental", "Mob", [
  (1, "A near-indestructible elemental sent as punishment for relieving yourself outside a bathroom; it dissipates only after claiming 666 souls. Fought on the 2nd floor."),
 ]),

E("Pocket Kuma", "Dungeon race", [(5, "A magic-infused half-fairy pet bred for the High Elf court; one of Mordecai's forms.")], rel=[(5, "Mordecai (form).")]),

E("Mongoliensis", "Dungeon creature", [
  (1, "Velociraptor pets that are never truly \"tamed.\" Mongo is Donut's."),
  (3, "A saddle turns one into a mount."),
  (5, "Kiwi, a scarred Mongoliensis pack leader, joins Donut."),
 ], rel=[(1, "Mongo."), (5, "Kiwi.")], aliases={2: ["velociraptor"]}),

E("Tummy Acher", "Dungeon creature", [
  (1, "A meatball with legs and a mohawk; one of Carl's pet options."),
  (6, "Also called Belly Achers."),
  (7, "Originally intestinal parasites of Jotan-class Titans (\"Colon Worms\"); good-natured. Carl bonds with one."),
 ], aliases={6: ["Belly Acher"], 7: ["Colon Worm"]}),

E("Moon Reaper", "Dungeon creature", [(8, "Janitor mobs from a dark corner of Sheol (15th floor). Mordecai uses one as a disguise.")]),
]
