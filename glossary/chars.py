# Characters — facts tagged by the book that first reveals them.
from model import E

CHARS = [
# ---------------- Core party ----------------
E("Carl", "Crawler (protagonist)", [
  (1, "Twenty-seven-year-old US Coast Guard veteran turned marine tech; he fights barefoot. Enters the dungeon chasing his ex-girlfriend's cat, Donut, and becomes her \"Royal Bodyguard.\" Wears the War Gauntlet of the Exalted Grull."),
  (2, "Race Primal, class Compensated Anarchist: bombs and traps. A ratings magnet who humiliates Prince Maestro on air."),
  (3, "Sponsored by the Valtay Corporation."),
  (4, "Becomes an adherent of Emberus. Sponsored by the Open Intellect Pacifist Action Network."),
  (5, "Class becomes Agent Provocateur. Loses the Valtay sponsorship and gains the Apothecary. Co-warlord of the Princess Posse."),
  (6, "Wears the Scavenger's Daughter patch; with Katia he assassinates Astrid."),
  (7, "Warlord Carl in Faction Wars."),
 ], rel=[(1, "\"Bodyguard\" of Princess Donut; ex of Beatrice; guide Mordecai."), (3, "Party: Donut, Mongo, Katia."), (7, "Pet: Rend."), (8, "The Naga royal widow Chandra claims him as her husband (Widow's Rights).")],
 aliases={1: ["Crawler Carl", "Royal Bodyguard Carl"]}),

E("Princess Donut", "Crawler", [
  (1, "Prize-winning Persian show cat (Grand Champion Best in Dungeon) who becomes intelligent and talks in the dungeon. Putting on a tiara puts her in the Blood Sultanate's line of succession on the 9th floor. Says she loves Ferdinand."),
  (2, "Class: Former Child Actor; a magic-missile caster and fan favourite. Her grandmother Princess Chonkalot is on Bea's tattoo."),
  (3, "Sponsored by Princess D'nadia."),
  (4, "Sponsored by the toy company Veriluxx."),
  (5, "Sponsored by the Apothecary. Briefly a Viper Queen. Co-warlord of the Princess Posse."),
  (7, "Named Champion of Nekhebit. D'nadia sold her sponsorship."),
  (8, "Assassin of Sekhmet; class Gurkha."),
 ], rel=[(1, "Owner Beatrice; Carl; pet Mongo; manager Mordecai; first love Ferdinand."), (5, "Minion Kiwi.")],
 aliases={1: ["Donut", "Grand Champion Best in Dungeon"], 6: ["Warlord Princess Donut"]}),

E("Mongo", "Pet", [
  (1, "Donut's Mongoliensis (velociraptor) pet, hatched in the dungeon."),
  (3, "Dungeon-born pets are Borant property; a saddle makes him a mount."),
  (5, "Meets Kiwi's raptor pack."),
  (7, "Best friends with Carl's pet Rend. A newborn Ursensus appears."),
  (8, "Kiwi and Mongo have babies."),
 ], rel=[(1, "Pet of Donut."), (7, "Friend of Rend."), (8, "Mate of Kiwi.")]),

E("Katia Grim", "Crawler", [
  (2, "Crawler whose race is Doppelganger: she can reshape her body."),
  (3, "From Iceland. Member of Hekla's Brynhild's Daughters. On the 4th-floor train she accidentally kills Hekla, then joins Carl and Donut. Sponsored by Princess Formidable. Class Monster Truck Driver."),
  (4, "Formidable sends her a bolt meant for Prince Maestro."),
  (5, "She opened the Gate of the Feral Gods onto Larracos, flooding it with sharks and jellyfish. Sponsored by the Apothecary."),
  (6, "Leaves the party to hunt down her ex-best friend Eva Sigrid, and kills her. With Carl, assassinates Astrid."),
  (7, "Worships Eileithyia; has a deal with Huanxin Jinx for the goddess. Also bound to the Blood Sultanate succession."),
 ], rel=[(3, "Party member of Carl and Donut; sponsor Formidable."), (6, "Killed Eva Sigrid.")], aliases={2: ["Katia"]}),

E("Mordecai", "Game guide / manager", [
  (1, "NPC game guide. Born a skyfowl, he became a Changeling on floor 3 of his own crawl (a Changeling Fire Mage Arcanist). He is reshaped into a new local mob each floor."),
  (3, "Forms include a Grulke infantryman."),
  (5, "Takes a Pocket Kuma form."),
  (6, "On his own 10th floor, his brother Uzzi died: Chaco used the Dart of Ophiotaurus to trap and kill the sponsored goddess Dodola after Odette's illegal deal with Huanxin Jinx went wrong. Odette was his manager. He reached the 11th floor before taking an exit deal."),
  (7, "Blames Odette and Chaco for Uzzi's death."),
 ], rel=[(1, "Guide of Carl and Donut."), (6, "Brother Uzzi; crewmates Chaco and Hold Steady; former manager Odette; feud with Huanxin.")]),

E("Beatrice", "Earth human", [
  (1, "Carl's ex-girlfriend and Donut's owner (a show-cat owner). Carl assumes she is dead."),
  (2, "Her lower-back Persian-cat tattoo shows Donut's grandmother, Princess Chonkalot."),
  (4, "Alive: an interlude shows her outside the dungeon, reunited with a cat she calls Ferdinand."),
  (5, "Odette saved her; Borant is pretending to have done it."),
  (6, "Appears on Odette's show."),
 ], rel=[(1, "Ex of Carl; owner of Donut.")], aliases={1: ["Bea", "Miss Beatrice"]}),

# ---------------- Crawlers ----------------
E("Imani C", "Crawler", [
  (1, "A nurse at the Meadow Lark retirement home who helps shelter its residents (and mercy-kills some)."),
  (3, "Leads team Meadow Lark with Elle."),
  (5, "Coordinates the guild."),
  (8, "Spearheads the guild's big planning efforts."),
 ], rel=[(1, "Partner Elle; with Yolanda, Brandon and Chris.")], aliases={1: ["Imani"]}),

E("Elle McGib", "Crawler", [
  (1, "An elderly woman in a wheelchair Carl helps into the storm shelter (Elle McGibbons)."),
  (2, "Reborn as a Frost Maiden Blizzardmancer."),
  (3, "A former Meadow Lark resident; Mistress Tiatha is her guide."),
  (5, "Class becomes Tundra Princess."),
  (8, "The war mages beat her up and steal the Gate of the Feral Gods from her."),
 ], rel=[(1, "Partner Imani."), (3, "Guide/manager Mistress Tiatha.")], aliases={1: ["Elle"]}),

E("Brandon An", "Crawler", [
  (1, "Meadow Lark maintenance worker who helps defend the residents."),
  (3, "Dies protecting the team's escape (from shade gremlins)."),
 ], rel=[(1, "Brother of Chris Andrews.")]),

E("Chris Andrews", "Crawler", [
  (1, "Brandon's brother, a Meadow Lark maintenance worker."),
  (3, "After a fight with Brandon he leaves the party and picks a rock race."),
  (4, "Maggie My (an Infiltrator) is inside him; with Maggie he got a Skull Empire celestial grenade meant to summon a god against Carl. Maggie-controlled Chris killed Frank Q."),
  (5, "Traveling with Li Jun and Li Na."),
 ], rel=[(1, "Brother of Brandon."), (4, "Controlled by Maggie My.")], aliases={1: ["Chris"]}),

E("Yolanda Martinez", "Crawler", [
  (1, "A tiny, fierce Meadow Lark nurse of about fifty who dies protecting the group from the Rage Elemental."),
  (5, "The guild Safehome Yolanda is named for her."),
 ], aliases={1: ["Yolanda"]}),

E("Agatha", [(1, "Crawler"), (6, "Crawler / Residual")], [
  (1, "A homeless, shopping-cart-pushing floor-1 crawler who kills mobs Carl finds."),
  (4, "Orren suspects Agatha and Odette of helping Carl."),
  (6, "A Residual, Agent number 22, \"a different kind\" from Paulie."),
  (7, "Named warlord of the War Mage Rebellion, to Akuma's dislike; later deemed to have abandoned her post."),
  (8, "Akuma tells Carl he has to kill Agatha."),
 ], rel=[(7, "War Mage Rebellion.")], aliases={6: ["Agent 22"]}),

E("Hekla", "Crawler", [
  (1, "An Icelandic crawler shown on the recap."),
  (2, "Leads Brynhild's Daughters; Amazonian Shieldmaiden; #2 on the bounty board."),
  (3, "Accidentally killed by Katia on the 4th-floor train."),
 ], rel=[(2, "Leader of Brynhild's Daughters."), (3, "Leader of Katia and Eva Sigrid.")]),

E("Eva Sigrid", "Crawler", [
  (3, "One of Brynhild's Daughters. Becomes party leader when Hekla dies; she and Katia tried to kill each other."),
  (4, "Still alive; half Nagini, half orc (Nimblefoot Enforcer). She and Hekla had used Katia as bait."),
  (6, "Katia hunts her down and kills her."),
 ], rel=[(3, "Katia's ex-best friend.")], aliases={3: ["Eva"]}),

E("Li Jun", "Crawler", [
  (1, "Crawler Carl helps save, with his sister Li Na and friend Zhang."),
  (2, "Human Street Monk."),
  (3, "Leads more than 1,000 survivors to safety on the 4th floor."),
  (5, "Turned into a vampire (later cured)."),
  (7, "Shi Maria plucks out his eye. He dies protecting Donut in a tower."),
 ], rel=[(1, "Brother of Li Na; best friend of Zhang.")]),

E("Li Na", "Crawler", [
  (1, "Li Jun's sister."),
  (3, "A demonic chain-fighter."),
  (5, "Her Changbi race lets her see god affiliations."),
  (7, "Uses Harpocrates against Meatus. Grief-stricken when Li Jun dies."),
 ], rel=[(1, "Sister of Li Jun.")]),

E("Zhang", "Crawler", [
  (1, "Li Jun's bald friend."),
  (3, "Human caster (Dirt Clod); secretly in love with Li Na."),
 ], rel=[(1, "Best friend of Li Jun.")]),

E("Daniel Bautista", "Crawler", [
  (2, "Kills the boss The Divider."),
  (3, "Tigran Swashbuckler (\"a tiger vomited upon by a Lisa Frank notebook\"); leads his own team and allies with Carl."),
 ], aliases={2: ["Bautista"]}),

E("Louis Santiago", "Crawler", [
  (4, "Energetic level-22 Pest Exterminator; best friend of Firas. Has the changeling Juice Box on his lap and \"awakens\" her."),
  (5, "Obsessed with the photo of Epitome Noflex, the Dream leader's mother. Samantha adores him."),
  (7, "Marries Juice Box."),
  (8, "Breaks up with Juice Box."),
 ], rel=[(4, "Best friend of Firas."), (7, "Husband of Juice Box.")], aliases={4: ["Louis"]}),

E("Firas M", "Crawler", [
  (4, "Level-22 Hammersmith, Louis's best friend."),
  (5, "Dies on the 6th floor."),
 ], rel=[(4, "Best friend of Louis.")], aliases={4: ["Firas"]}),

E("Britney Proskurina", "Crawler", [
  (4, "Human Pit Fighter, last survivor (with the cosmetic surgeon Vadim) of their original party."),
  (6, "Badly burned; on Katia's team with Louis."),
  (8, "Kills Osvaldo."),
 ], aliases={4: ["Britney"]}),

E("Tran", "Crawler", [
  (4, "A Swashbuckler with a metal-detecting ability on Katia's team."),
  (5, "Loses his legs and his friend Gwen at the end of the 6th floor."),
 ], rel=[(4, "Friend of Gwen.")]),

E("Gwendolyn Duet", "Crawler", [
  (4, "Crawler on the 5th floor; her team looted the gate coordinates off Quetzalcoatlus."),
  (5, "Dies at the end of the 6th floor."),
 ], rel=[(4, "Friend of Tran.")], aliases={4: ["Gwen"]}),

E("Florin", "Crawler", [
  (2, "Crocodilian Shotgun Messenger, a top-ten crawler."),
  (4, "Lucia Mar killed Ifechi, his close companion."),
  (5, "Ifechi was his girlfriend; he grieves when Queen Imogen wears her face."),
 ], rel=[(5, "Partner of Ifechi.")]),

E("Ifechi", "Crawler", [
  (2, "Human Physicker (healer) in the top ten."),
  (4, "Killed by Lucia Mar at the end of the 4th floor (a woman)."),
  (5, "Florin's girlfriend; Queen Imogen wears her face."),
 ], rel=[(5, "Girlfriend of Florin.")]),

E("Quan Ch", "Crawler", [
  (2, "Imperial Security Trooper who gets a celestial robe."),
  (3, "Half-elf; got a Celestial Quest box."),
  (4, "Prepotente swears to kill him."),
  (5, "One-armed; now a Sergeant-at-Arms."),
 ], rel=[(4, "Enemy of Prepotente.")]),

E("Lucia Mar", "Crawler", [
  (1, "The kid crawler at #1, with two rottweilers, Cici and Gustavo 3."),
  (2, "Race Lajabless."),
  (4, "Kills Ifechi."),
  (6, "Donut kills one of her dogs."),
  (7, "Gustavo dies (Rend saves Mongo). Lucia killed Bomo, and one of her dogs once ate Mukta."),
  (8, "She has thousands of children trapped inside her head; if she dies, they die."),
 ], rel=[(1, "Pets Cici and Gustavo."), (4, "Killer of Ifechi.")], aliases={1: ["Lucia"]}),

E("Miriam Dom", "Crawler", [
  (2, "Human Shepherd, \"the goat lady.\""),
  (3, "Travels with her goat Prepotente."),
  (4, "Turned into a vampire."),
  (5, "Has a hellspawn goat, Bianca. Dies during the Butcher's Masquerade; Prepotente keeps her ashes."),
 ], rel=[(3, "\"Mother\" of Prepotente."), (5, "Owner of Bianca.")], aliases={2: ["Miriam"]}),

E("Prepotente", "Crawler", [
  (2, "A caprid crawler, Forsaken Aerialist, high on the bounty board."),
  (3, "Miriam Dom's goat."),
  (4, "Becomes the highest-level crawler after a big kill."),
  (5, "Class Profane Vitiate. Grieves his \"mother\" Miriam."),
  (7, "Hellik's rams put a Holy Crusade bounty on him."),
  (8, "Holds Apito's Memorial Crystal; races with Jurgen on the tapir Sweety."),
 ], rel=[(3, "Miriam Dom's goat."), (5, "Bianca."), (8, "Teammate Jurgen.")]),

E("Bianca", "Pet", [
  (5, "Hellspawn goat familiar of Miriam Dom (Bianca Del Ciao)."),
  (6, "Now Prepotente's; she ate Osvaldo's hawk Gimli."),
 ], rel=[(5, "Miriam Dom."), (6, "Prepotente.")]),

E("Frank Q", "Crawler (antagonist)", [
  (1, "Crawler-killer who, with his wife Maggie, attacks Carl's group; their daughter is Yvette."),
  (3, "Gives Carl the Ring of Divine Suffering, then is killed by another crawler."),
  (4, "Chris (controlled by Maggie) crushed his head."),
  (6, "Returns as a card: \"Leveled-Up Frank.\""),
 ], rel=[(1, "Husband of Maggie My; father of Yvette.")], aliases={1: ["Frank"]}),

E("Maggie My", "Crawler (antagonist)", [
  (1, "Frank Q's wife."),
  (2, "Prince Maestro gives her a Legendary Skill potion."),
  (3, "She killed her own daughter, Yvette."),
  (4, "An Infiltrator: she is inside Chris. Sponsored by Prince Maestro and Crown Prince Stalwart."),
 ], rel=[(1, "Wife of Frank Q."), (4, "Controls Chris.")], aliases={1: ["Maggie"]}),

E("Dmitri and Maxim Popov", "Crawlers", [
  (3, "Brothers sharing one nodling body."),
  (5, "Their game guide Hongrish recommended the race for its extra life."),
  (6, "Ejected from the game."),
 ], aliases={3: ["Popov"]}),

E("Sister Ines", "Crawler", [
  (6, "Cleric leading Team Sister Ines; a cat girl and nun murderer. She stabs Paz with her team flag."),
 ], rel=[(6, "Teammates Paz, Anton.")]),

E("Paz Lo", "Crawler / card", [
  (6, "Paladin on Sister Ines's team who worships Ogun. Turned into a card, he kills the goddess Ysalte; his card is ripped at the end of the 8th floor."),
 ], rel=[(6, "Teammate of Anton.")], aliases={6: ["Paz"]}),

E("Anton", "Crawler", [(6, "Fugitive-class former prison guard on Sister Ines's team; dies when the god Ogun smites him.")], rel=[(6, "Teammate of Paz.")]),

E("Osvaldo", "Crawler", [
  (5, "Brazilian crawler who takes the Memorial Crystal of Apito."),
  (6, "Owner of the hawk Gimli, which Bianca ate."),
  (8, "Worships Tupa. Killed by Britney."),
 ]),

E("Jurgen", "Crawler", [
  (6, "A crawler in Carl's chat."),
  (7, "Big blond barbarian; pretends his pregnant wife Heidi is with him."),
  (8, "Races with Prepotente on the tapir Sweety."),
 ]),

# ---------------- Former crawlers / cookbook authors ----------------
E("Drakea", "Former crawler", [
  (3, "Author of the 22nd edition of the Cookbook, the most verbose annotator."),
  (4, "A crawler during the final Naga-run season."),
  (6, "Killed by one of their own traps after the showrunners rigged it to blow early."),
  (7, "Hated the Naga."),
 ]),

E("Herot", "Former crawler", [
  (3, "Author of the 16th edition of the Cookbook, with an essay on NPCs (\"The Worn Path Method\")."),
  (4, "Advocated breaking NPCs out of the fourth wall."),
  (8, "Still alive. With Menerva, found an exploit that lets NPCs survive."),
 ], rel=[(8, "Partner of Menerva.")]),

E("Menerva", "Former crawler", [
  (7, "A name from the past: \"Go, Menerva had screamed.\""),
  (8, "With Herot, found an exploit to let NPCs survive; runs the NPCs building the Backstage Death Maze on the 17th floor."),
 ], rel=[(8, "Partner of Herot.")]),

E("Tipid", "Former crawler", [
  (6, "Author of the 4th edition of the Cookbook."),
  (7, "A Crest; once chose to save himself when a key only let one out. Joins the Princess Posse."),
  (8, "About to lose his memory."),
 ], rel=[(7, "Ally of Rosetta.")]),

E("Rosetta", "Former crawler", [
  (3, "A Cookbook annotator."),
  (6, "A Crest with her own show."),
  (7, "Rosetta of the Shadow Boxer show, author of the 7th edition; joins the Princess Posse."),
  (8, "Explains the Scavenger myth."),
 ], rel=[(7, "Ally of Tipid.")], aliases={7: ["Rosetta Thag"]}),

E("Boomer", "Former crawler", [(7, "Former crawler leading the 106th Bloody Leeches; a Princess Posse colonel.")]),

E("Uzzi", "Former crawler", [
  (6, "Mordecai's brother, a skyfowl. On Mordecai's 10th floor he was the vessel for trapping Dodola; Chaco's Dart of Ophiotaurus killed him."),
 ], rel=[(6, "Brother of Mordecai.")]),

E("Hold Steady", "Former crawler", [(6, "Skyfowl caster who kept the god-trapping puzzle primed on Mordecai's 10th floor.")], rel=[(6, "Crewmate of Mordecai and Uzzi.")]),

E("Chaco", "Former crawler / host", [
  (3, "Chaco the Bard, former crawler champion and \"slayer of gods,\" host of a prize show."),
  (6, "Wolf-headed pterolykos; Mordecai's old crewmate who killed Uzzi with the Dart of Ophiotaurus."),
 ], rel=[(6, "Enemy of Mordecai.")]),

E("Odette", [(1, "Talk-show host"), (6, "Host / former crawler")], [
  (1, "Host of Dungeon Crawler After Hours with Odette; a crab-taur in a bug mask."),
  (5, "Her trial was a farce; she pleaded down. She saved Beatrice."),
  (6, "Mordecai's former manager. Her illegal deal with Huanxin Jinx (through Armita) led to Uzzi's death. Plays the goddess Nekhebit."),
  (8, "Controls Sekhmet; her husband is an orc."),
 ], rel=[(1, "Assistant Lexis."), (6, "Former manager of Mordecai; friend of Armita; enemy of Huanxin.")]),

E("Armita", "Celestial attendant", [(6, "Odette's friend and former party member, a demigod Ascendency attendant who set up Odette's deal with Huanxin. Huanxin killed her the next season.")], rel=[(6, "Friend of Odette.")]),

# ---------------- Off-world aliens / showrunners ----------------
E("Zev", "Kua-tin admin", [
  (1, "Kua-tin Borant Assistant Communications Representative who handles Carl and Donut's PR; wears a water-filled helmet."),
  (5, "Promoted after Borant's takeover."),
 ], rel=[(1, "Handler of Carl and Donut.")]),

E("Loita", "Kua-tin admin", [
  (3, "Kua-tin admin who replaces Zev."),
  (4, "Dies, assassinated by Carl; he loots her rebreather."),
 ]),

E("Mukta", "Kua-tin admin", [
  (1, "Substitute admin who puts Carl and Donut on Prince Maestro's show."),
  (7, "Eaten by one of Lucia Mar's dogs."),
 ]),

E("Cascadia", [(5, "Kua-tin"), (7, "Kua-tin showrunner")], [
  (5, "A kua-tin; \"Cascadia's Screams.\""),
  (6, "The \"kill, kill, kill\" lady; the 7th floor was her baby."),
  (7, "Showrunner and executive producer of the season."),
 ]),

E("Orren", "Syndicate liaison", [
  (4, "The hooded Syndicate liaison who says crawlers can't murder admins."),
  (5, "Grim-reaper-like; sits in on Carl's hearings."),
  (6, "His cover was manager of the Desperado Club."),
 ]),

E("Quasar", [(5, "Lawyer"), (8, "Nullian lawyer")], [
  (5, "Carl's lawyer; negotiates with Orren."),
  (8, "A Nullian; built the Princess Posse's legal entities."),
 ], rel=[(5, "Attorney for Carl and Donut.")]),

E("Victory", "Orc noble", [
  (6, "Baroness Victory, esquire, formerly of the Skull Empire: half-sister of the late Queen Consort Ugloo, and a judge."),
  (7, "Judge Victory helps the Princess Posse. Huanxin Jinx dies at her feet."),
  (8, "Prime Minister Victory runs the Syndicate's temporary HQ on Earth."),
 ], rel=[(6, "Aunt of Maestro, Stalwart and Formidable.")], aliases={6: ["Baroness Victory"], 7: ["Judge Victory"], 8: ["Prime Minister Victory"]}),

E("King Rust", "Orc king", [
  (1, "King of the Skull Empire, now in Earth orbit."),
  (2, "Disowns Maestro."),
  (7, "Says he will sue for peace, then dies."),
 ], rel=[(3, "Father of Maestro, Stalwart and Formidable.")], aliases={1: ["Rust"]}),

E("Queen Consort Ugloo", "Orc queen", [
  (2, "Rumoured aboard the yacht the Valtay destroyed."),
  (3, "Dead, with Maestro thought dead too."),
  (5, "Mother of Maestro and Stalwart; the Valtay blew up her yacht over Manasa."),
 ], rel=[(5, "Mother of Maestro and Stalwart."), (6, "Half-sister of Victory.")], aliases={2: ["Ugloo"]}),

E("Prince Maestro", "Orc prince", [
  (1, "Skull Empire prince and talk-show host whom Carl humiliates (\"Carl's Naughty Little Piggie\")."),
  (2, "Disowned and stripped of titles; reported dead."),
  (3, "Supposedly killed by the Valtay over Manasa, but he returns as Grull's sponsor and driver on the 4th floor."),
  (4, "Sponsors Maggie My."),
  (8, "Still not dead."),
 ], rel=[(1, "Brother of Stalwart."), (3, "Son of Rust; drives Grull.")], aliases={1: ["Maestro", "Pork Boy"]}),

E("Stalwart", [(1, "Orc prince"), (7, "Orc king")], [
  (1, "Crown Prince of the Skull Empire, Maestro's older brother."),
  (2, "Claims to have assassinated Carl and Donut (wrongly), killing Manasa."),
  (4, "Sponsors Maggie My; sues Carl."),
  (6, "Donut proposes renaming him \"Captain Enormous.\""),
  (7, "Becomes King Stalwart when Rust dies (he has six children), then dies in Faction Wars."),
 ], rel=[(1, "Brother of Maestro."), (3, "Son of Rust.")], aliases={1: ["Crown Prince Stalwart"], 6: ["Captain Enormous"], 7: ["King Stalwart"]}),

E("Princess Formidable", "Orc princess", [
  (3, "Youngest sister of Maestro and Stalwart; sponsors Katia."),
  (4, "Sends Katia a countermeasure (the bolt)."),
  (6, "At odds with her family."),
  (7, "Third daughter of Rust; tries to kill Carl."),
 ], rel=[(3, "Sponsor of Katia.")], aliases={3: ["Formidable"]}),

E("D'nadia", "Saccathian royal", [
  (2, "Princess of the Prism, a panelist on Danger Zone."),
  (3, "Sponsors Donut."),
  (6, "Now Warlord Empress D'nadia; proposes deleting Carl and Donut."),
  (7, "Sells Donut's sponsorship. Falls in Faction Wars."),
 ], rel=[(3, "Sponsor of Donut.")], aliases={2: ["Princess D'nadia"], 6: ["Empress D'Nadia"]}),

E("Manasa", "Valtay-run celebrity", [
  (2, "Cobra-headed pop singer whose corpse the Valtay keep performing; killed by a Skull Empire attack meant for Carl."),
 ]),

E("Ripper Wonton", "Host", [(2, "Host of Danger Zone with Ripper Wonton."), (5, "A quokka.")], aliases={2: ["Ripper"]}),

E("Huanxin Jinx", "Grixist heiress", [
  (6, "Grixist CEO of Icon Industries, driving the goddess Eileithyia. In an earlier season she drove Dodola; her old feud with Odette and Mordecai dates to that crawl. She killed Armita."),
  (7, "Killed."),
 ], rel=[(6, "Enemy of Odette and Mordecai."), (7, "Deal with Katia.")], aliases={6: ["Huanxin"]}),

E("Circe Took", "Mantis matriarch", [
  (5, "Mantis matriarch of the Dark Hive who drives the goddess Diwata against Carl; killed at the Masquerade."),
 ], rel=[(5, "Mother of Vrah.")], aliases={5: ["Circe"]}),

E("Vrah", "Mantis hunter", [(5, "Dark Hive mantis hunter, furious with Carl after her little sister is killed; Mongo and Kiwi kill her.")], rel=[(5, "Daughter of Circe Took.")]),

E("Epitome Tagg", "Dream elf", [(5, "Leader of the Dream; Louis offended his mother's honor."), (6, "Son of Epitome Noflex.")], aliases={5: ["Tagg"]}),

E("Warlord Fang", "Reaver", [(7, "Reaver Faction Wars warlord.")]),

E("Architect Houston", "Viceroy", [(7, "Masked Viceroy leader of team Madness; dies in Faction Wars.")]),

E("Mistress Tiatha", "Manager", [(1, "Meadow Lark's guide."), (3, "Elle's drunk game guide."), (5, "Elle's manager.")], aliases={1: ["Tiatha"]}),

E("Lexis", "Production assistant", [(1, "Odette's production assistant.")]),

# ---------------- Dungeon NPCs ----------------
E("Signet", "Elite NPC", [
  (2, "Tsarina Signet: a half-naiad, half-high-elf summoner (bastard of King Finian) in the 3rd-floor circus storyline \"Vengeance of the Daughter.\""),
  (5, "A coup killed her mother and got her banished; her goal is her half-sister Queen Imogen. She gives Carl a body meant for Samantha. She kills herself to get her revenge on Imogen."),
  (6, "Grimaldi was her husband."),
 ], rel=[(2, "Daughter of King Finian."), (5, "Half-sister of Imogen.")], aliases={2: ["Tsarina Signet"]}),

E("Queen Imogen", "Country boss", [
  (5, "High Elf queen, \"Chosen Daughter of Apito,\" country boss of the Butcher's Masquerade; she wears Ifechi's face. Killed at the end of the floor; crawlers fight over her corpse."),
 ], rel=[(5, "Half-sister of Signet.")], aliases={5: ["Imogen"]}),

E("King Finian", "High Elf king", [(2, "High-Elf King of the Liana Sector, who bedded women of 5,000 races."), (5, "Dead; he ordered the Pocket Kuma executed.")], rel=[(2, "Father of Signet."), (5, "Father of Imogen.")]),

E("Juice Box", "Changeling NPC", [
  (4, "A changeling prostitute at a 5th-floor inn whom Louis \"awakens\"; her brother is Henrik."),
  (7, "Warlord of Team Retribution, the NPC team; marries Louis."),
  (8, "Louis breaks up with her."),
 ], rel=[(4, "Sister of Henrik."), (7, "Wife of Louis.")]),

E("Henrik", "Changeling NPC", [(4, "Juice Box's brother, a 5th-floor changeling leader tied to the necropolis storyline; he dies on the 5th floor.")], rel=[(4, "Brother of Juice Box.")]),

E("Ferdinand", [(1, "Cat"), (5, "Cat NPC")], [
  (1, "Donut says she loves Ferdinand."),
  (2, "\"Ferdinand is the love of my life\" (not his real name)."),
  (4, "Bea finds the cat she called Ferdinand."),
  (5, "He's in the dungeon as a boss NPC."),
  (7, "Warlord on High, Sir Ferdinand, of Team Retribution."),
 ], aliases={7: ["Sir Ferdinand", "Warlord on High, Sir Ferdinand"]}),

E("Akuma", "War mage", [(7, "Leader of the War Mage Rebellion; dislikes co-warlord Agatha."), (8, "Insists Carl kill Agatha.")]),

E("Princess Vinata", "Naga princess", [(7, "Naga princess of the Blood Sultanate who worships Khepri; killed.")], aliases={7: ["Vinata"]}),

E("Astrid", "Desperado Club", [
  (3, "A Bloodlust Sprite."),
  (5, "Level-125 assistant manager of the Desperado Club."),
  (6, "Katia and Carl kill her for the Guild of Suffering. Her husband is Hamed, the Night Wyrm."),
 ], rel=[(6, "Wife of Hamed.")]),

E("Night Wyrm", [(3, "Name on a ring"), (5, "Demigod")], [
  (3, "Carl's Ring of Divine Suffering is the Night Wyrm's."),
  (5, "A demigod outside the regular pantheon."),
  (6, "Real name Hamed: Astrid's husband."),
  (7, "Father of the strippers Damascus Steel and Anaconda, who hunt him; he becomes manager of the Desperado Club."),
  (8, "Hamed leads the Guild of Suffering and set them up to kill Astrid."),
 ], rel=[(6, "Husband of Astrid."), (7, "Father of Damascus Steel and Anaconda.")], aliases={3: ["The Night Wyrm"], 6: ["Hamed"]}),

E("Damascus Steel", "NPC", [(6, "Level-75 Ifrit stripper at the Penis Parade."), (7, "Son of Hamed and Astrid.")]),

E("Dong Quixote", "NPC", [(6, "Elderly human stripper of the Penis Parade."), (7, "Fights with his crust sock.")], aliases={6: ["Dong"]}),

E("Clarabelle", "NPC", [(2, "A Crocodilian."), (3, "Bouncer of the Desperado Club.")]),

E("Pater Coal", "NPC", [(6, "Hobbledehoy High Cleric Supreme of Emberus in Club Vanquisher."), (7, "Taken over by the AI.")]),

E("Shi Maria", "Card / spider", [
  (6, "Reaper spider totem in Donut's card deck (\"MaeMae\")."),
  (7, "The Eye of the Bedlam Bride is a card; Shi Maria plucks out Li Jun's eye."),
  (8, "The Eye of the Bedlam Bride is tattooed on Carl's chest."),
 ], aliases={6: ["MaeMae"]}),

E("Geraldo", "Card", [(6, "Monk-seal kung-fu totem in Donut's deck.")]),

E("Kiwi", "Pet/minion", [
  (5, "Scarred Mongoliensis pack leader who joins Donut. Her daughter Tina. At the end of the floor she turns into a very pregnant bear."),
  (6, "She and Big Tina used to be bears."),
  (7, "Born an Ursine; turned into a dinosaur by Scolopendra's attack."),
 ], rel=[(5, "Donut; mother of Big Tina.")]),

E("Rend", "Pet", [(7, "Carl's Tummy Acher pet; saves Mongo from Gustavo.")], rel=[(7, "Pet of Carl.")]),

E("Penelope", "Pet / party member", [(8, "A pig protected by Taranis; she joins Carl's party (Penny) and wears Kina's kneepads.")], aliases={8: ["Penny"]}),

E("Ghazi", "NPC", [(4, "The Mad Dune Mage: a glass mage who sought the Gate of the Feral Gods to speak with Yarilo, and turned himself into a sand elemental.")], aliases={4: ["Mad Dune Mage"]}),

E("Tally", "Bopca", [(1, "Carl and Donut's first Bopca Protector.")]),
]
