# Gods, demigods, demons and divine lore — facts tagged by the book that first reveals them.
from model import E

GODS = [
E("Celestial Ascendency", "Divine lore / game", [
  (3, "A game played alongside the crawl: the big gods (Apito, Eris and so on) are sponsored by rich players who pay extra to play. The Cookbook warns: only idiots deal with deities."),
  (4, "The gods' halls are on the 12th floor, and all gods lose their invulnerability there; they compete for the Celestial Throne. A \"locked\" god cannot be sponsored that season (Emberus is one)."),
  (6, "The Ascendency battles start when the crawlers reach the 12th floor. AI subroutines are legally forbidden from monitoring sponsor communications; demigod attendants (e.g. Odette's friend Armita) serve the Ascendency."),
  (8, "Under Ascendency rules a defeated god with no worshippers has its level cut in half (subjugation). On the 10th floor the AI announces the game's gods are now effectively real, and invites outside intelligences to compete."),
 ], rel=[
  (5, "Circe Took drives Diwata."),
  (6, "Huanxin Jinx drives Eileithyia (earlier, Dodola); Pontifex Shine drives Ysalte; Odette drives Nekhebit."),
  (7, "Nami drives Eris; Prince Maestro still drives Grull."),
 ], aliases={3: ["Celestial Ascendency", "Ascendency"], 4: ["Celestial Throne"], 6: ["Ascendency battles"]}),

E("Taranis", "God – thunder", [
  (3, "Father of the war god Grull; worries his hot-tempered son may not be fit to rule the heavens."),
  (4, "God of Thunder and regent to the Celestial Throne. In the 5th-floor sky myth he strolls across the sky chased by his \"red brother\" Hellik. Emberus calls him his older brother."),
  (5, "Husband of Apito; he and Apito threw the first Butcher's Masquerade for their feuding family. He raged when his wife exiled his child."),
  (7, "Worshipped by the ogre Basilica guards of Club Vanquisher, who can briefly stop a deity crossing a threshold."),
  (8, "Big brother of Emberus, Hellik and Eris, and married to Apito, who is also his mother. Yarilo is his child. He magically protects Penelope the pig."),
 ], rel=[
  (3, "Father of Grull."), (4, "Older brother of Emberus and Hellik."), (5, "Husband of Apito."),
  (6, "Half-brother, uncle and former lover of Eris."), (8, "Son of Apito; father of Yarilo."),
 ], aliases={4: ["God of Thunder"]}),

E("Apito", "Goddess – oak/mother", [
  (2, "The Oak Mother. A street cult preaches \"the good news about Apito the Oak Mother\" on the 3rd floor; one story says her angels must stay free and alive to keep the path to heaven open."),
  (3, "Elf mothers abandoned the old goddess Nekhebit to worship Apito, the Oak Goddess. Her child with Taranis is Grull. A big god, always sponsored."),
  (5, "Wife of Taranis, the Blessed Oak Mother; hosted the first Butcher's Masquerade and exiled one of Taranis's children. Queen Imogen styles herself \"Chosen Daughter of Apito.\" Carl's quest names a Memorial Crystal: Apito."),
  (6, "\"Apito lives, yet there is a crystal made by her\" – the Memorial Crystal of Apito is a mystery."),
  (7, "Hellik's message: \"our mother and sister, Apito, has been corrupted.\""),
  (8, "Daughter of Nekhebit: she defeated her mother by absorbing the last of the vulture goddess's worshippers, and the new gods expelled the old. She is also Taranis's mother. She banished Yarilo (her grandson and stepson) to the Nothing. The Scavenger's Daughter would hold the same power Apito had."),
 ], rel=[
  (3, "Mother of Grull."), (5, "Wife of Taranis."), (7, "Mother/sister of Hellik (per Hellik)."),
  (8, "Daughter of Nekhebit; sister of Scolopendra; mother of Taranis."),
 ], aliases={2: ["Oak Mother", "Apito the Oak Mother"], 3: ["Oak Goddess"], 5: ["Blessed Oak Mother"]}),

E("Grull", "God – war", [
  (1, "War god. Carl's Enchanted War Gauntlet of the Exalted Grull has a 1.5% chance to transfigure a struck adherent into the deity. His worshippers tend to be horses, centaurs and other equine creatures."),
  (2, "Mordecai bets a sponsor will have chosen Grull."),
  (3, "Son of Taranis and Apito, one of the few trueborn heirs to the Celestial Ascendency, with a temper. On the 4th floor Carl summons him; he is sponsored and driven by Prince Maestro of the Skull Empire."),
  (4, "Carl earns the option to worship Grull (he doesn't)."),
  (6, "Prince Maestro is still inside Grull's body; Elle got a spell after the first fight with \"the Maestro in Grull form\"."),
  (8, "Female mantaurs don't worship Grull like most of their kind. Grull enters the realm on the 11th floor."),
 ], rel=[(3, "Son of Taranis and Apito; driven by Prince Maestro.")],
 aliases={1: ["Exalted Grull", "War God Grull"]}),

E("Emberus", "God – sun and ash", [
  (4, "Sun and Ash God (\"Emberus the Fire God\"), a locked god with no sponsor this season. He rampages across the 5th floor looking for his dead son's dog Orthrus. Carl becomes his adherent and gets two quests: Kill Hellik, and find out who murdered his son Geyrun."),
  (5, "Carl gets Emberus tattoos and owes the Emberus shrine blood and gold. Adherents get bonus damage against adherents of Diwata, and Carl gets a bonus for killing worshippers of Hellik."),
  (6, "Carl must question the high cleric at the Emberus Shrine in Club Vanquisher about Geyrun's murder."),
  (7, "Enters the 9th floor in a fury; Hellik's message only enrages him further."),
  (8, "Warns Carl that if Carl kills Hellik, Emberus will kill him for completing the quest."),
 ], rel=[
  (4, "Twin of Hellik (enemies); younger brother of Taranis; father of Geyrun; Carl is his adherent."),
  (6, "Half-brother of Eris."), (8, "Cleric: Pater Coal."),
 ], aliases={4: ["Emberus the Fire God", "god of sun and ash"]}),

E("Hellik", "God – sun and life", [
  (4, "God of Sun and Life, the \"red brother\" of the 5th-floor sky myth. Twin of Emberus, obsessed with killing both Emberus and Taranis. Emberus gives Carl the quest Kill Hellik."),
  (5, "Carl gets a bonus for killing Hellik's worshippers. A Temple of Hellik appears on the 6th floor."),
  (6, "His worshippers include the ram-like Ares Warrior Clerics (Potsy). He is the main suspect in Geyrun's murder, but had an alibi."),
  (7, "Mork and the rams put a Holy Crusade bounty on Prepotente. Hellik makes Carl a \"friend of the church\" and tells him: he didn't kill Emberus's son, and Apito \"has been corrupted.\""),
 ], rel=[(4, "Twin and enemy of Emberus; younger brother of Taranis."), (6, "Half-brother of Eris.")],
 aliases={4: ["God of Sun and Life", "red brother"]}),

E("Eris", "Goddess – chaos", [
  (1, "Goddess of Chaos (mentioned in a mob description)."),
  (3, "A big god, always sponsored by some rich player."),
  (5, "Known for parties."),
  (6, "Half-sister and niece of her former lover, Taranis."),
  (7, "Mother to nobody, lover of parties and drinking, the Ascendency's worst gossip (\"a wine aunt\"). Sponsored by the influencer Nami this season. On the 9th floor she casts Bear Witness, and ends up trapped in a ball with the feral god Meatus, used against Harpocrates."),
  (8, "Returns at level 251; her presence has a random chaotic effect. Akuma: \"Eris knows everything.\""),
 ], rel=[(6, "Half-sister, niece and former lover of Taranis."), (7, "Driven by Nami.")],
 aliases={1: ["Goddess of Chaos"]}),

E("Diwata", "Goddess – forest", [
  (5, "A minor forest goddess (switches between female and male). On the 6th floor her temple and birth use a captured hunter; she is sponsored and driven by Circe Took of the Dark Hive. Carl smashes her shrine and becomes Enemy of the Church. \"One of Apito's brood, but not a direct child.\""),
  (6, "Circe was angry enough to fly to Earth and play as Diwata."),
  (8, "Her worshippers (e.g. fairies born of fairies and forest animals) are automatically hostile to Carl."),
 ], rel=[(5, "Driven by Circe Took; enemy of Emberus's adherents (Carl).")]),

E("Nekhebit", "Old goddess – vulture", [
  (3, "A long-forgotten goddess, jealous and terrible. When elf mothers abandoned her to worship Apito, she grew enraged. Carl finds a crossbow of the \"Scavenger Mother of Mothers\" given to her last warrior guardian."),
  (6, "Re-ascends: Odette plays (\"performs as\") the ancient goddess in the Ascendency."),
  (7, "Princess Donut is named Champion of Nekhebit and joins her court (she can't worship anyone outside it)."),
  (8, "Called the Scavenger Mother of Mothers. In the old times a life and protector deity. She was the last old god to fall, defeated by her daughter Apito. Her children: Apito, Scolopendra and a mysterious son."),
 ], rel=[(6, "Driven by Odette."), (7, "Champion: Donut."), (8, "Mother of Apito, Scolopendra and an unnamed son.")],
 aliases={3: ["Scavenger Mother of Mothers"]}),

E("Scavenger's Daughter", "Divine lore / item", [
  (6, "Carl's Scavenger's Daughter patch, installed on his jacket: it charges from his melee kills and upgrades."),
  (7, "The patch reacts when \"fed.\" The War Mages claim to have taken the Scavenger's Daughter; Carl wonders whether it is Samantha's daughter."),
  (8, "Myth: the daughter of \"the Scavenger\" (sometimes Scolopendra, sometimes Nekhebit's son, who lives in the empty plane gathering souls). She holds the same power Apito had."),
 ], rel=[(7, "Possibly Samantha's daughter; sought by the War Mage Rebellion."), (8, "Linked to Nekhebit, Apito and Scolopendra.")],
 aliases={6: ["Scavenger's Daughter patch"], 8: ["The Scavenger"]}),

E("Geyrun", "God (murdered)", [
  (4, "Murdered god, son of Emberus; his dog Orthrus was sucked into the Nothing at the time. Emberus tasks Carl with finding the killer; Hellik is the obvious suspect but was in council when it happened."),
  (6, "Carl must question the Emberus high cleric and Amayon about the murder."),
  (7, "Samantha says she may have had \"an indirect, possibly direct hand\" in his death. Amayon claims to know what happened."),
  (8, "By the end of Book 8 the killer is still unconfirmed."),
 ], rel=[(4, "Son of Emberus; owner of Orthrus.")]),

E("Orthrus", "Divine beast", [
  (4, "A two-headed hellhound puppy, bereft pet of Geyrun, lost in the Nothing when Geyrun died. Released on the 5th floor, he chases Carl and Donut's biplane; Emberus storms the floor looking for him."),
 ], rel=[(4, "Pet of Geyrun; Emberus's household.")]),

E("Psamathe", "Lesser deity", [
  (4, "A banished lesser deity (Samantha to her friends), accompanied by an ooze familiar. Her father banished her to the Nothing for consorting with an ancient king. She duped Carl by pretending to be Yarilo and took over the necropolis ghost Queen Quetzalcoatlus; she survives as a disembodied sex-doll head that travels with the party."),
  (5, "Half-naiad; calls herself \"long-lost daughter of the confederacy.\" Signet gives Carl a body meant for her."),
  (6, "Her mother is a goddess."),
  (7, "Her mother is the goddess Theia. She claims a hand in Geyrun's death. Carl wonders if the War Mages' \"Scavenger's Daughter\" is her daughter."),
 ], rel=[(4, "Companion of Carl and Donut."), (5, "Naiad Confederacy ties; Signet is kin."), (7, "Daughter of Theia.")],
 aliases={4: ["Samantha"]}),

E("Theia", "Goddess", [
  (7, "Named: Theia. She has a long Ascendency history and is a poor bet for the throne; instead of clerics, she turns prospective worshippers into balls of light. The Open Intellect's agent Rectrix drives her."),
  (8, "Her 9th-floor temple turns out to hold a skyfowl, not her."),
 ], rel=[(7, "Mother of Samantha; driven by Rectrix.")]),

E("Yarilo", "Feral god – lust", [
  (4, "Banished god of lust. The glass mage Ghazi sought the Gate of the Feral Gods to talk to him in the Nothing (Samantha pretended to be him)."),
  (5, "\"It was Yarilo, god of lust, who broke the peace\" at the Masquerade."),
  (7, "Banished for ruining one of Apito's Butcher's Masquerade parties. On the 9th floor he appears as a mortal feral god and dies."),
  (8, "Child of Taranis; banished by Apito."),
 ], rel=[(8, "Son of Taranis.")], aliases={4: ["god of lust"]}),

E("Meatus", "Feral god", [
  (7, "A feral god from the Nothing: a gremlin-like creature who stole Harpocrates's \"dink,\" sewed it on himself and became a god (the gremlin stays small; the appendage scales). On the 9th floor he fights Harpocrates, wrapped in a ball with Eris."),
 ], rel=[(7, "Enemy of Harpocrates.")]),

E("Harpocrates", "God – silence", [
  (7, "The silent god (Mordecai: don't use your PA near him). Robbed by Meatus; fights him on the 9th floor and ends up a member of the Princess Posse."),
 ], rel=[(7, "Robbed by Meatus; joins the Princess Posse.")]),

E("Ogun", "God – blacksmiths", [
  (6, "God of Blacksmithery and Armor, an outsider from an obscure faded pantheon who forges armor at his celestial anvil. Worshipped by crawlers in the Cuba cemetery; Carl fails to save the prison guard Anton from him."),
 ], rel=[(6, "Worshipped by Anton and Paz.")]),

E("Eileithyia", [(5, "Goddess"), (6, "Goddess – childbirth")], [
  (5, "Mentioned alongside \"the Vinegar Bitch.\""),
  (6, "Goddess of Childbirth and Female Pain, \"She Who Eases Pain\"; benevolent. Sponsored by Huanxin Jinx. Her dear friend Yemaya is her retainer; she sends Carl a secret deity message."),
  (7, "Katia worships her; Katia has a deal for Eileithyia to go to the 12th as a celestial attendant."),
 ], rel=[(6, "Driven by Huanxin Jinx; friend of Yemaya."), (7, "Worshipped by Katia.")],
 aliases={6: ["She Who Eases Pain"]}),

E("Yemaya", "Goddess – rivers", [
  (6, "Goddess of Rivers, once of all waters, forgotten when her people died. Carl and Donut resurrect her; she appears as a dark-skinned mermaid."),
  (7, "Called \"the Starbucks logo\"; she whitelists Carl."),
 ], rel=[(6, "Retainer and friend of Eileithyia.")]),

E("Ysalte", [(4, "Goddess"), (6, "Goddess – hopelessness")], [
  (4, "One of the gods summoned through the Gate on the 5th floor: \"the Vinegar Bitch.\""),
  (6, "Goddess of Hopelessness and Insanity (earlier of the Dirt, then of Tears), worshipped by the earliest citizens of Larracos and sponsored by Pontifex Shine of the Nebular Balance. Slain by Paz, producing a Memorial Crystal."),
 ], rel=[(6, "Former girlfriend of Amayon and mother of his child; killed by Paz.")],
 aliases={4: ["Vinegar Bitch"]}),

E("Amayon", "Demon prince", [
  (6, "One of the four princes of Sheol, appearing in the Cuba region; Emberus sends Carl to question him about Geyrun."),
  (7, "Claims to know what happened to Geyrun; came to the world in a demon eviction event."),
 ], rel=[(6, "Brother of the other Sheol princes; Ysalte was his ex and mother of his child.")]),

E("Khepri", "God – sunrise", [
  (7, "God of Rebirth and the Sunrise, a bug-headed weirdo; retainer of Khnum (whose sub-pantheon is dying off), and his boss Adrasteia has an outside shot at the throne. Vinata ends up stuck in his room full of bugs. Carl faces him in his temple."),
  (8, "His temple in Club Vanquisher is \"never-fucking-ending.\" Carl claims \"the first person to kill your son was the god Khepri\" to bring him in."),
 ], rel=[(7, "Retainer of Khnum/Adrasteia.")]),

E("Dodola", "Goddess (sponsored)", [
  (6, "A sponsored storm goddess, driven by Huanxin Jinx in an earlier season. In Mordecai's flashback Odette's illegal deal goes wrong; Uzzi and Mordecai trap her and Chaco kills her, knocking Huanxin out of the Ascendency before it began. Dodola stabs the larger storm god Adad."),
 ], rel=[(6, "Driven by Huanxin Jinx; linked to Mordecai, Uzzi, Odette, Chaco.")]),

E("Lamashtu", [(5, "Name (potion)"), (8, "Subjugated god")], [
  (5, "Mentioned: a potion called the Milk of Lamashtu."),
  (8, "Lamashtu the Donkey, level 125: a defeated god cut in half and subjugated by the system AI; Grigori rides her."),
 ], rel=[(8, "Subjugated by the AI.")], aliases={8: ["Lamashtu the Donkey"]}),

E("Asojano", "Former god (Orisha)", [
  (6, "Lord of Smallpox, one of the most feared Orishas, a former god made flesh when the Ascendency rose. Met in the Cuba region with Sister Ines and Anton."),
 ], rel=[(6, "Orisha pantheon with Oshun, Legba and Inle.")], aliases={6: ["Lord of Smallpox"]}),

E("Mazu", "Goddess", [(7, "Summoned by a Viceroy team in a past Faction Wars; razed the ring of buildings outside Larracos.")]),

E("Kina", "Goddess – sea", [
  (7, "A sea-urchin-like bottom-feeder goddess. Katia gets the Enchanted Spiked Knee Pads of the Munificent Goddess Kina (made of her eyelashes)."),
  (8, "The kneepads pass to Donut and then to Penelope."),
 ]),

E("Minor and mentioned gods", "God index", [
  (4, "Enyo: her nuns made celestial grenades. Algos: a god someone worships. Kuraokami: an ocean goddess worshipped (and sponsored) on the 5th floor."),
  (5, "Inpewt: those he crushes become the undead Children of Inpewt."),
  (6, "Adad: a big storm god in Odette's flashback. Legba (rooster), Oshun and mute Inle: Orisha shrines in the Cuba cemetery. Ibeji: a temple there; Kuraokami's temple doubles as an entrance to Club Vanquisher."),
  (7, "Adrasteia: Khepri's boss. Khnum: mysteriously dropped dead. Donar: thunder god. The Dagda: god of the 9th-floor entrance temple. Issitoq: his High Cleric of the Watch can allow breaking the 9th-floor truce. Inpewt: Odette has taken him out and controls his zombies."),
  (8, "Gula: worshipped by Grigori. Sekhmet: a feral cat goddess under Odette's thumb; Donut becomes Assassin of Sekhmet. Tupa: worshipped by Osvaldo."),
 ], aliases={4: ["Enyo", "Algos", "Kuraokami"], 5: ["Inpewt"], 6: ["Adad", "Legba", "Papa Legba", "Oshun", "Inle", "Ibeji"],
             7: ["Adrasteia", "Khnum", "Donar", "Dagda", "The Dagda", "Issitoq"], 8: ["Gula", "Sekhmet", "Tupa"]}),

E("Nothing", "Divine lore / place", [
  (4, "The empty plane where gods, demons and others were banished in the original Ascendency, many going mad. The Gate of the Feral Gods and the winding box can open a way in. Residents included Samantha, Yarilo, Orthrus and Slit."),
  (5, "Samantha: \"There's a beaver god in the Nothing.\""),
  (6, "A group of sisters (the harem demons, like Minge) are trapped there."),
  (7, "When someone escapes it, the god who banished them usually comes to deal with them. Meatus and Yarilo escape on the 9th floor."),
  (8, "The skyfowl Justice Light breaks the Nothing, releasing the demon women who hate Samantha."),
 ], aliases={4: ["The Nothing"]}),

E("Feral god", "Divine lore", [
  (4, "A god or demon released from the Nothing. Opening the Gate of the Feral Gods (5th floor, Necropolis) lets one through, and may also summon a real god to deal with it."),
  (7, "Feral gods are not immortal on the floor where they appear."),
 ], aliases={4: ["Feral Gods", "Gate of the Feral Gods"]}),

E("Sheol", "Place – hell", [
  (2, "The 15th floor of the World Dungeon. Sheol Glass Reaper Cases are forged there (1.5% chance of Sheol Fire when opened)."),
  (3, "Sheol Bricks: hardened corpses that burn long and hot."),
  (6, "Ruled by four demon princes (Amayon is one)."),
  (7, "Sheol demons such as Amayon reach the world during demon eviction events."),
  (8, "Moon Reapers are its janitor mobs. In myth, when the new gods came, one old god was banished to Sheol."),
 ], aliases={2: ["Sheol Fire"], 3: ["Sheol Bricks"]}),

E("Slit", "Feral minor demon", [
  (4, "A feral minor demon tossed into the Nothing in the original Ascendency, \"caught up in all that royal drama\"; kaiju-sized and out to kill Samantha. A god crushes her at the end of the 5th floor."),
 ]),

E("Minge", "Feral minor demon", [
  (6, "Slit's little sister, a higher-level minor feral demon (not a kaiju) who escapes the Nothing, wrecks the Desperado Club and hunts Samantha before dying."),
 ], rel=[(6, "Sister of Slit; hunts Samantha.")]),

E("Memorial Crystal", "Item / divine lore", [
  (5, "Like soul crystals, but created by fallen gods and demons. A cult has a Memorial Crystal of Apito; the crawler Osvaldo takes it."),
  (6, "Osvaldo looted it off Queen Imogen's body."),
  (6, "A Memorial Crystal of Ysalte is created when she dies. The Apito crystal is a mystery: Apito lives."),
  (8, "Prepotente now holds the Apito crystal; it protects him and anyone in the same building or mount."),
 ]),

E("Ascendency family tree", "Relations overview", [
  (3, "Taranis + Apito &rarr; Grull (war). Old goddess Nekhebit was abandoned by the elves for Apito."),
  (4, "Taranis's brothers: Emberus and Hellik (twin sun gods, mortal enemies). Emberus &rarr; son Geyrun (murdered; dog Orthrus). Psamathe (Samantha) was banished by her father."),
  (6, "Eris: half-sister, niece and ex-lover of Taranis. Eileithyia &larr; retainer/friend Yemaya. Demon prince Amayon + Ysalte &rarr; a child."),
  (7, "Theia &rarr; daughter Samantha. Khnum/Adrasteia &larr; retainer Khepri."),
  (8, "Nekhebit &rarr; Apito, Scolopendra and an unnamed son. Apito is also Taranis's mother. Taranis &rarr; Yarilo."),
 ], aliases={4: ["pantheon"]}),

E("DCC books", "Glossary key", [
  (1, "Each fact is tagged with the book where it is first revealed: [1] Dungeon Crawler Carl, [2] Carl's Doomsday Scenario, [3] The Dungeon Anarchist's Cookbook, [4] The Gate of the Feral Gods, [5] The Butcher's Masquerade, [6] The Eye of the Bedlam Bride, [7] This Inevitable Ruin, [8] A Parade of Horribles. Enable only the dictionary for the last book you've finished."),
 ], aliases={1: ["Dungeon Crawler Carl series"]}),
]
