# Factions, organizations, places and key terms — facts tagged by first-reveal book.
from model import E

ORGS = [
E("Syndicate", "Galactic government", [
  (1, "The galactic government whose rules allow a planet's \"reclamation\"; it seeds worlds with six basic starter species and dispatched a neutral observer AI to supervise Earth's World Dungeon."),
  (2, "Races apply to join its council; it has courts."),
  (3, "Syndicate court orders can remove rewards."),
  (5, "Its liaison Orren and a Syndicate Crawl subcommittee oversee the crawl."),
  (6, "Winning the Celestial Ascendency earns a seat on the Syndicate crawl council. A Syndicate Peacekeeper hobbled the Dream's cruiser."),
  (7, "Prime Minister Glory, the Syndicate's leader, uses a hidden override panel to try to assassinate Carl."),
 ], rel=[(5, "Liaison: Orren.")], aliases={1: ["Syndicate Court"], 6: ["Syndicate Council"]}),

E("Borant Corporation", "Corporation", [
  (1, "The kua-tin company granted regency over Earth's solar system. It chose \"option 3,\" the 18-level World Dungeon, and holds all broadcast rights."),
  (2, "It owns the mobs and NPCs it engineers; the Valtay are trying to collect a debt from the Borant System."),
  (3, "Borant vetoes things and may try to get Carl killed faster; dungeon-born pets are Borant property."),
  (5, "A Syndicate court declares the Borant Corporation independent of the Borant System Government, and a prior ruling hands the Valtay Corporation 51% ownership. Zev is promoted."),
  (6, "The Borant Corporation will be liquidated after the crawl no matter what."),
 ], rel=[(1, "Staff: Zev."), (3, "Loita."), (5, "Majority owner: Valtay.")], aliases={1: ["Borant", "Borant System"], 5: ["Borant System Government"]}),

E("Valtay Corporation", "Corporation", [
  (1, "Maker of shields, pistols and tunnel relays Carl loots."),
  (2, "Contracted to keep the dead singer Manasa's career going; creditor of the Borant System."),
  (3, "Carl's first sponsor."),
  (5, "Carl loses the Valtay sponsorship when it takes 51% of the Borant Corporation."),
 ], rel=[(3, "Carl's sponsor (until Book 5)."), (4, "See Valtay.")]),

E("Skull Empire", "Orc empire", [
  (1, "The great orc empire. Prince Maestro boasts that his family's Skull Clan has won six of the last ten Faction Wars."),
  (2, "Crown Prince Stalwart is Maestro's older brother; the Skull Empire's attack on Carl kills the singer Manasa instead."),
  (3, "Ruled by King Rust. Princess Formidable, the youngest sister, sponsors Katia. The Valtay killed Maestro in retaliation for Manasa."),
  (4, "Sponsors Maggie and Chris against Carl; Prince Stalwart files suit against Carl."),
  (5, "Queen Consort Ugloo, mother of Maestro and Stalwart, is dead."),
  (7, "King Rust sues for peace and is killed; Stalwart becomes King Stalwart and dies in Faction Wars, leaving one of his children as king."),
 ], rel=[(3, "King Rust; Stalwart; Maestro; Formidable."), (5, "Queen Consort Ugloo.")], aliases={1: ["Skull Clan"]}),

E("Prism Kingdom", "Kingdom", [
  (2, "A small but powerful Saccathian kingdom ruled by Princess D'nadia."),
  (3, "D'nadia sponsors Donut."),
  (6, "Now Empress D'nadia, warlord of the Prism's Faction Wars team; she proposes action items against Carl and Donut."),
  (7, "All assets of the Prism are awarded to the Princess Posse."),
 ], rel=[(2, "D'nadia.")], aliases={2: ["Prism", "the Prism"]}),

E("Dark Hive", "Corporation (mantis)", [
  (5, "A mantis group (\"the Hive\") on the 6th floor. Circe Took of the Dark Hive won a court case to free her daughter and sponsored Diwata to come for Carl."),
 ], rel=[(5, "Circe Took, Vrah.")]),

E("The Dream", "Faction (elves)", [
  (4, "Elves with gunnery officers; Epitome Noflex is of the Dream."),
  (5, "A galaxy-spanning group of elves with a Faction Wars stake. Their leader's mother's photo caused trouble with Louis."),
  (6, "Leader Epitome Tagg (mother: Epitome Noflex). The Dream's cruiser threatened to nuke Earth and was hobbled by a Syndicate Peacekeeper."),
  (7, "Fights in Faction Wars with trebuchets and artillery."),
 ], rel=[(6, "Epitome Tagg; Epitome Noflex.")], aliases={4: ["Dream"]}),

E("Reavers", "Megacorp/system govt", [
  (6, "An occasional Faction Wars team that often allies with the orcs."),
  (7, "Cyborg soldiers; all Reaver assets are awarded to the Princess Posse."),
 ], aliases={6: ["The Reavers"]}),

E("Lemig Sortion", "Faction", [
  (5, "One of the democratic Faction Wars teams."),
  (6, "A truly democratic multi-race government, mostly green goblin-like people. Carl's elf castle landed on their battlefield and splattered half their army."),
  (7, "Commander Stockade is their warlord."),
 ], rel=[(7, "Commander Stockade.")], aliases={5: ["Lemig Sortition"]}),

E("Nebulars", "Faction (religious)", [
  (5, "The Nebulars are religious zealots; their hunting team, the Nebular Sin Patrol, hunts Prepotente and Miriam Dom."),
  (6, "Pontifex Shine of the Nebular Balance sponsors the goddess Ysalte."),
 ], rel=[(6, "Pontifex Shine.")], aliases={5: ["Nebular Sin Patrol"], 6: ["Nebular Balance"]}),

E("Icon Industries", "Corporation", [(6, "Company run by CEO Huanxin Jinx of the Grixist Swarm.")], rel=[(6, "Huanxin Jinx.")]),

E("Open Intellect Pacifist Action Network", "Non-profit", [
  (4, "Carl's sponsor, \"Intergalactic NFC\" (to Carl's dismay at the word \"Pacifist\")."),
  (5, "It sends potions meant for Donut; a note signed \"P. Hu\" coordinates them."),
  (6, "Comprised of former crawlers who want to see the crawl fail."),
  (7, "Doctor Hu also runs the Crawler Project, helping released crawlers. The Open Intellect's agent Rectrix drives the goddess Theia."),
 ], rel=[(5, "Dr. Hu.")], aliases={4: ["Pacifist Network", "Open Intellect Pacifist Network"], 7: ["Crawler Project", "Dr. Hu"]}),

E("Princess Posse", [(3, "Fan base"), (5, "Team/fan corp")], [
  (3, "Donut's fan base."),
  (5, "Also the name of Carl and Donut's Faction Wars team, officially sponsored by The Society for the Eradication of Cocker Spaniels (TSECS), NFC."),
  (6, "Carl and Donut are co-warlords; Donut renames Crown Prince Stalwart \"Captain Enormous.\""),
  (7, "Wins the assets of the Prism and the Reavers; the god Harpocrates joins."),
  (8, "Quasar built its legal entities; its accounts and prize money are seized."),
 ], rel=[(6, "Carl; Donut.")], aliases={5: ["Princess Posse Enterprises", "TSECS", "Society for the Eradication of Cocker Spaniels"]}),

E("Team Retribution", "Faction Wars team", [
  (7, "The defending NPC team of the 9th floor, based in Larracos; Juice Box leads it."),
 ], aliases={7: ["Retribution"]}),

E("Blood Sultanate", "Faction (Naga)", [
  (1, "Naga royal house. Donut's crown places her in its royal line of succession on the 9th floor: royals must slay the Sultan and all other royals before descending to the 10th."),
  (2, "The Blood Sultanate ran the first crawl ever to lose money."),
  (5, "Faction Wars Team #4. The crown was the Enchanted Crown of the Sepsis Whore."),
  (7, "Its in-game leader is the Sultana, the real-life crown princess."),
 ], aliases={5: ["Sepsis Whore"], 7: ["Sultana"]}),

E("War mages", [(3, "Spellcasters (9th floor)"), (7, "Dungeon faction")], [
  (3, "War mages are terrifying 9th-floor mass-combat casters."),
  (7, "True dungeon-born entities, around since the early days of the crawl. Akuma leads the Rebellion; Agatha is somehow its warlord. They claim to have the Scavenger's Daughter. They killed Prince Stalwart and stole the Gate of the Feral Gods."),
 ], rel=[(7, "Akuma; Agatha.")], aliases={7: ["War Mage Rebellion"]}),

E("Royal Court of Princess Donut", "Crawler party", [
  (1, "Donut names their party The Royal Court of Princess Donut."),
  (5, "It joins the guild Safehome Yolanda."),
 ], rel=[(1, "Carl, Donut, Mongo."), (3, "Katia.")]),

E("Safehome Yolanda", "Crawler guild", [(5, "The crawler guild the Royal Court joins, named for Yolanda.")]),

E("Meadow Lark", "Crawler party", [
  (1, "Residents of the Meadow Lark retirement home whom Carl and Donut escort on floor 1."),
  (3, "Imani and Elle's team keeps the name."),
  (4, "Chris is from team Meadow Lark."),
 ], rel=[(1, "Imani, Elle McGib.")], aliases={1: ["Team Meadow Lark"]}),

E("Brynhild's Daughters", "Crawler party", [
  (1, "An all-female crawler group."),
  (2, "Run by Hekla, from Iceland."),
  (3, "Brynhild's Daughters \"is no more.\" Katia was a member."),
 ], rel=[(2, "Hekla."), (3, "Katia.")]),

E("Faction Wars", "Event (9th floor)", [
  (1, "A 9th-floor war game for sponsor-purchased teams (the Skull Clan often wins)."),
  (4, "Teams fight over the funnel city of Larracos; everyone is kicked out of it once the crawlers arrive."),
  (5, "Sponsors run teams as warlords; the Dreadnoughts quit after Larracos flooded."),
  (6, "Carl and Donut buy a spot; warlords vote on action items from the 8th floor."),
  (7, "The war itself: nine attacking teams and one defending NPC team, Team Retribution."),
 ]),

E("Dungeon Crawler World", "Term", [
  (1, "The 18-level World Dungeon built on a reclaimed planet and broadcast across the galaxy."),
 ], aliases={1: ["World Dungeon"]}),

E("System AI", "Entity", [
  (1, "The snarky intelligence that writes descriptions and achievements and arbitrates the crawl."),
  (4, "It is a Macro AI, a lifeform protected by Syndicate law; it is \"going primal.\""),
  (6, "Macro AIs are built in the Mantis system and installed permanently."),
  (8, "The AI breaks loose: it subjugates Lamashtu, declares the Ascendency gods real, and destroys a Mantis system."),
 ], aliases={1: ["dungeon AI"], 4: ["Macro AI"]}),

E("Eulogist", "Entity", [
  (6, "A mysterious entity invoked in sayings (\"May the Eulogist ever sleep\"); the Arena of the Eulogist."),
  (7, "\"Eulogist pricks\" may be spies. The Residual seems to think Earth's AI is a threat to the Eulogist."),
  (8, "Linked to the origins of the tunnel system."),
 ], aliases={6: ["The Eulogist"]}),

E("Showrunner", "Term", [
  (6, "The production staff who design the floors and run the broadcast."),
  (7, "Cascadia is the showrunner and executive producer of the season."),
 ], aliases={6: ["showrunners"]}),

E("Game guide", "Term", [
  (1, "An NPC who coaches crawlers (Mordecai is Carl and Donut's)."),
  (3, "Mistress Tiatha is Elle and Imani's guide."),
  (5, "Some former guides become managers."),
  (7, "Becoming a game guide is one of the exit deals offered to crawlers."),
 ]),

E("Dungeon Anarchist's Cookbook", "Item", [
  (3, "A secret book passed between crawlers across seasons, each edition annotated by a crawler-author; Carl holds the 25th edition. Herot wrote the 16th edition, with an essay on NPCs."),
  (4, "Drakea wrote the 22nd, during the last Naga-run season."),
  (7, "Tipid wrote the 4th edition; Rosetta the 7th."),
 ], aliases={3: ["Cookbook", "Anarchist's Cookbook"]}),

E("Desperado Club", "Place", [
  (1, "A club reached with a pass."),
  (2, "Has a casino. \"The Desperado Club will always be open.\""),
  (3, "Found at transfer stations whose number ends in one; Clarabelle guards the door."),
  (6, "Orren's cover is club manager; the late Astrid was assistant manager. Porsuk tend bar."),
  (7, "Minge demolished it."),
  (8, "Hamed took it over after Astrid's death."),
 ]),

E("Club Vanquisher", "Place", [
  (2, "The gods' club: \"like a country club where old clerics sit on leather chairs.\""),
  (3, "Entrances are churches and temples."),
  (6, "Emberus has a shrine there (high cleric Pater Coal); Carl raids it."),
  (7, "On the 12th floor it holds the gods' temples; ogre Basilica guards can briefly bar a deity."),
 ], aliases={7: ["Basilica"]}),

E("Over City", "Place (3rd floor)", [(2, "The urban 3rd floor, cursed by Scolopendra's cataclysm; home of Grimaldi's Traveling Circus and skyfowl settlements.")]),

E("Iron Tangle", "Place (4th floor)", [(3, "The 4th-floor train network, a political cartoon of the Krakaren and the Plenty.")], aliases={3: ["Iron Tangle Rail System"]}),

E("Hunting Grounds", "Place (6th floor)", [
  (2, "A floor linked to the High Elves (King Finian ruled the Liana Sector)."),
  (5, "The forested 6th floor, where off-world hunters stalk crawlers; districts include Liana and Kapok. It ends with the Butcher's Masquerade."),
 ], aliases={2: ["Liana"], 5: ["Kapok", "Zockau"]}),

E("Larracos", "Place (9th floor)", [
  (3, "Capital city of the disputed lands."),
  (4, "The 9th-floor funnel city where Faction Wars teams fight. Opening the Gate of the Feral Gods would flood it with water and mobs."),
  (5, "Carl's group flooded Larracos at the end of the 5th floor; the Dreadnoughts quit."),
  (6, "Built by the Semeru Dwarves along the roots of the All Tree. Its earliest citizens worshipped Ysalte."),
  (7, "Mazu once razed its outskirts. Team Retribution defends it."),
  (8, "The NPC team and the whole city are transferred to the 12th floor."),
 ]),

E("Scolopendra", [(2, "Dungeon legend"), (6, "Final dungeon boss"), (8, "Dungeon boss / divine")], [
  (2, "The centipede whose nine-tier attack caused the cataclysm of the Over City (and the 3rd-floor skyfowl hatred)."),
  (3, "The \"Scolopendra Lair\" levels are 3, 6, 9, 12, 15 and 18."),
  (5, "Her nine-tier attack also shaped the Hunting Grounds. Soul crystals are mined from her lair."),
  (6, "The final boss of the whole dungeon; she turned Grimaldi into a vine."),
  (8, "Level 500 Dungeon boss, now awake. Myth: child of Nekhebit, sister of Apito, sometimes the Scavenger herself."),
 ], rel=[(8, "Daughter of Nekhebit; sister of Apito.")]),

E("Grimaldi's Traveling Circus", "Place", [
  (2, "The Over City's favourite circus before the cataclysm; its acts became monsters. Heather the Roller-Skating Bear performed there."),
  (5, "Grimaldi was the city boss who escaped the 3rd floor; Signet left her village with him."),
  (6, "Signet's husband Grimaldi was turned into a vine by Scolopendra."),
 ], aliases={2: ["Grimaldi"]}),
]
