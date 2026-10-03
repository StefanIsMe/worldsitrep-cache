// Per-theatre live-wire configs. One entry per site theatre except ukraine
// (which keeps its own collector + gazetteer). All sources keyless except
// ReliefWeb (free approved appname, same secret as ukraine).
// Feeds verified live 2026-09-24, expanded 2026-09-28 (+53: HTTP 200 + parsed + dated). GDELT FIPS 10-4
// codes; gazetteer coords are major-city reference points (approximate tier).
// Relevance gates 2026-10-01: shared US_POLITICS/SAHEL_CRISIS/ARCTIC_WATCH/GAZA match lists; GDELT off for us-election (RSS-only); nunatsiaq/nnsl dropped (~0% topic-relevant).
// Plus: optional match safety net on us-election GNews feeds (Trump queries drift into foreign stories); \b bounds on MALI/IDF/PLA/KIM (Somali/midfield/display/skim collisions).

const gnews = (id, theatre, query, match) => ({
  id,
  theatre,
  name: 'Google News',
  url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US%3Aen',
  outletFromSourceTag: true,
  ...(match ? { match } : {}),
});

// Federal politics + elections relevance (us-election native feeds, verified 2026-10-01).
const US_POLITICS_MATCH = [
  '\\bTRUMP\\b', '\\bVANCE\\b', '\\bBIDEN\\b', '\\bHARRIS\\b', 'WHITE HOUSE', 'OVAL OFFICE',
  'AIR FORCE ONE', 'MAR-A-LAGO', 'ADMINISTRATION', '\\bSECRETARY\\b', 'CONGRESS', 'SENATE',
  'SENATOR', 'HOUSE-PASSED', 'HOUSE PASSED', 'HOUSE SPEAKER', 'HOUSE BILL', 'HOUSE VOTE',
  'HOUSE PANEL', 'HOUSE MAJORITY', 'HOUSE MINORITY', 'HOUSE REPUBLICANS', 'HOUSE DEMOCRATS', 'SPEAKER OF THE HOUSE',
  'MAJORITY LEADER', 'MINORITY LEADER', 'CAPITOL', '\\bCOMMITTEE\\b', 'FILIBUSTER', 'RECONCILIATION',
  '\\bRECON\\b', '\\bLAWMAKERS?\\b', 'SCOTUS', 'SUPREME COURT', 'FEDERAL JUDGE', 'FEDERAL COURT',
  'APPEALS COURT', 'CIRCUIT COURT', 'JUSTICE DEPARTMENT', '\\bDOJ\\b', 'ATTORNEY GENERAL', '\\bFBI\\b',
  'SPECIAL COUNSEL', 'LAWSUIT', '\\bSUED\\b', '\\bSUES\\b', '\\bSUING\\b', 'SUBPOENA',
  'INDICT', 'PARDON', 'CONTEMPT', 'INJUNCTION', 'RESTRAINING ORDER', '\\bELECTIONS?\\b',
  'ELECTORAL COLLEGE', 'BALLOT', 'MIDTERM', '\\bPRIMARY\\b', '\\bPRIMARIES\\b', 'CAUCUS',
  '\\bPOLLS?\\b', 'VOTE', 'CAMPAIGN', 'CANDIDATE', 'ENDORSE', 'FUNDRAIS',
  'SUPER PAC', 'AD BUY', 'DEBATE', 'GERRYMANDER', 'REDISTRICT', 'CENSUS',
  'APPORTIONMENT', 'REFERENDUM', 'BALLOT MEASURE', 'RECALL ELECTION', 'FACES RECALL', 'DEMOCRAT',
  '\\bDEMS?\\b', 'REPUBLICAN', '\\bGOP\\b', '\\bMAGA\\b', 'DEMOCRACY', 'INSURRECTION',
  'CORRUPTION', 'GOVERNOR', 'GUBERNATORIAL', '\\bGOV\\b', 'NATIONAL GUARD', 'PENTAGON',
  '\\bMILITARY\\b', 'MARINE CORPS', '\\bMARINES\\b', 'HOMELAND SECURITY', 'TROOPS', 'U\\.S\\. ARMY',
  'U\\.S\\. NAVY', '\\bBORDER\\b', 'DEPORT', 'EXPEL', 'EXPULSION', 'ICE AGENTS?',
  'ICE RAID', 'ICE CUSTODY', 'ICE DETENTION', 'ICE ARREST', 'MIGRANT', 'ASYLUM',
  'SANCTUARY', 'TARIFF', 'TRADE WAR', 'TRADE DEAL', 'TRADE DEFICIT', 'TRADE TENSIONS',
  'TRADE TALKS', 'TRADE POLICY', 'FREE TRADE', 'EXECUTIVE ORDER', 'SHUTDOWN', 'VETO',
  'NOMINEE', 'NOMINATION', 'CONFIRMATION', 'CABINET', 'IMPEACH', 'PROTEST',
  'DEMONSTRATORS?', '\\bRIOT\\b', 'CULTURE WAR', 'TREASON', 'CLAWBACK', 'TAXPAYER',
  'TAX (BILL|CUT|HIKE|PLAN|REFORM|VOTE)', 'ABORTION', 'GUN CONTROL', 'SECOND AMENDMENT', 'WITHDRAW', 'FEDERAL RESERVE',
  '\\bPOWELL\\b', '\\bFTC\\b', 'SEC (CHAIR|CHARGES?|SUES?|FINES?|PROBE|INVESTIGATION|RULES?|FILINGS?)', '\\bFCC\\b',
  'MIKE JOHNSON', '\\bSCHUMER\\b', '\\bTHUNE\\b', '\\bJEFFRIES\\b', 'SECURITY CLEARANCE'
];

// Gaza / Israel / West Bank / Lebanon relevance (was inline x3, extracted 2026-10-01).
const GAZA_MATCH = [
  'GAZA', 'HAMAS', 'ISRAEL', '\\bIDF\\b', 'NETANYAHU', 'JERUSALEM',
  'TEL AVIV', 'WEST BANK', 'HEZBOLLAH', 'HOSTAGE', 'CEASEFIRE', 'PALESTIN',
  'HOUTHI', 'RAFAH', 'JENIN', 'NABLUS', 'RAMALLAH', 'HEBRON',
  'LEBANON', 'BEIRUT', 'SYRIA', 'DAMASCUS', 'AIRSTRIKE', 'SETTLER'
];
// France student-protest relevance (verified 2026-10-03: france24-en 4/24 kept,
// bbc-france 3/22, rfi-en 1/21, zero false positives in-sample; PARIS dropped -
// Channel-crime and state-visit noise; NICE dropped - adjective collision).
const FRANCE_MATCH = [
  'CRÉTEIL', 'CRETEIL', 'MARSEILLE', 'LYON', 'NANTES', 'LILLE', 'RENNES', 'BORDEAUX', 'TOULOUSE', 'STRASBOURG', 'MONTPELLIER', 'PANTIN', 'SAINT-DENIS', 'AUBERVILLIERS', 'PERPIGNAN', 'NÎMES', 'NIMES', 'TOURS', 'MEAUX', 'ÎLE-DE-FRANCE', 'ILE-DE-FRANCE', 'SEINE-SAINT-DENIS', 'VAL-DE-MARNE',
  'LECORNU', 'GEFFRAY', 'NUÑEZ', 'NUNEZ', 'DARMANIN', 'MÉLENCHON', 'MELENCHON', 'BOMPARD', 'BAGAYOKO', '\\bLFI\\b', 'LA FRANCE INSOUMISE', 'RETAILLEAU', 'ATTAL', 'PÉCRESSE', 'PECRESSE', '\\bUSL\\b', 'UNION SYNDICALE',
  'LYCÉE', 'LYCEE', 'STUDENT PROTEST', 'STUDENTS PROTEST', 'SCHOOL PROTEST', 'STUDENT UNREST', 'FRENCH UNREST', 'SCHOOL BLOCKADE', 'BLOCKADE', 'PARCOURSUP', 'BLOCUS', 'YELLOW VEST',
];

// Sahel crisis relevance; country names excluded on purpose (sports name them too). Verified 2026-10-01.
const SAHEL_CRISIS_MATCH = [
  'ATTACK', 'AMBUSH', 'DEADLY CLASH', 'VIOLENT CLASH', 'ARMED CLASH', 'BORDER CLASH', 'ETHNIC CLASH', 'CLASHES (ERUPT|KILL|LEAVE|BREAK|SPREAD|CONTINUE)', 'CLASH (KILLS|KILLED|LEAVES|ERUPTS)', 'CLASHES WITH', 'CLASH WITH', 'CLASHES NEAR', 'CLASH NEAR', 'KILLED', 'KILLING', 'MASSACRE',
  'ABDUCT', 'KIDNAP', 'BOMB', 'BLAST', 'AIRSTRIKE', 'DRONE',
  'HUNGER STRIKE', 'GENERAL STRIKE', 'STRIKE (KILLS?|KILLED|WOUNDS?|HITS?|DESTROYS?)', 'WAR CRIMES', 'CIVILIANS?', 'JUNTA',
  '\\bCOUPS?\\b', 'WAGNER', 'AFRICA CORPS', 'JNIM', 'QAEDA', '\\bAQIM\\b',
  'ISGS', 'ISWAP', 'BOKO', 'JIHAD', 'TERROR', 'INSURGENT',
  'REBELS?', 'TUAREG', '\\bAES\\b', 'ECOWAS', '\\bUN\\b', 'U\\.N\\.',
  'UNGA', 'FRANCE', 'FRENCH', 'RUSSIA', 'RUSSIAN', 'ELECTION',
  'VOTE', 'REFERENDUM', 'SANCTION', 'HUMAN RIGHTS', 'HOSTAGE', 'DISPLACED',
  'REFUGEE', 'HUMANITARIAN', 'FOOD AID', 'FOREIGN AID', 'MILITARY AID', 'AID GROUP',
  'AID WORKERS?', 'AID CONVOY', 'CEASEFIRE', 'PEACE', 'EXILE', 'REPRESS',
  'CRACKDOWN', 'PROTEST', 'JOURNALIST', 'PRESS FREEDOM', 'CORRUPTION', 'FAMINE',
  'DROUGHT', 'FLOODS?', 'MIGRANT', 'ASYLUM', 'ARMS', 'WEAPONS',
  'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA',
  'MÉNAKA', 'TESSALIT', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b',
  'OUAHIGOUYA', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA',
  'TAHOUA', 'SAHEL',
  'DISINFORMATION', 'INFORMATION WAR', 'PROPAGANDA', 'URANIUM', 'GOLD (REFINERY|MINE|MINERS?|MINING|RESERVES?|PRICES?|EXPORTS?|TRADE|SMUGGLING|SECTOR|INDUSTRY)', 'REFINERY',
  'MINING', 'MINERALS?', 'GUNSHOTS?', 'GUNFIRE', 'EXPLOSIONS?', 'GUNNED DOWN',
  'OPENED FIRE', 'MASS SHOOTING', 'DEADLY SHOOTING'
];

// Arctic geopolitics relevance for regional outlets (no place-only terms). Verified 2026-10-01.
const ARCTIC_WATCH_MATCH = [
  'ARCTIC', 'GREENLAND', 'NUUK', 'ILULISSAT', 'PITUFFIK', 'THULE',
  'SVALBARD', 'LONGYEARBYEN', 'TROMSØ', 'TROMSO', 'KIRKENES', 'REYKJAVIK',
  'REYKJAVÍK', 'MURMANSK', 'NORTHERN SEA', 'NORTHWEST PASSAGE', 'NORTHEAST PASSAGE', 'BERING',
  'CHUKCHI', 'BEAUFORT', 'BARENTS', 'BAFFIN', 'FRAM STRAIT', 'RUSSIA',
  'RUSSIAN', 'KREMLIN', 'MOSCOW', 'CHINA', 'CHINESE', 'BEIJING',
  'DENMARK', 'DANISH', 'NORWAY', 'NORWEGIAN', 'FINLAND', 'FINNISH',
  'ICELAND', 'ICELANDIC', 'SWEDEN', 'SWEDISH', 'OTTAWA', 'WASHINGTON',
  'NATO', 'MILITARY', 'DEFEN[CS]E', 'COAST GUARD', 'ICEBREAKER', 'NORAD',
  'RCAF', 'INTERCEPT', 'SURVEILLANCE', 'RADAR', 'SUBMARINE', 'BOMBER',
  '\\bFIGHTERS?\\b', 'F-35', 'C-130', 'SOVEREIGNTY', 'TERRITORIAL WATERS', 'TERRITORIAL DISPUTE',
  'TERRITORIAL CLAIM', 'TERRITORIAL SEA', 'PATROL', 'RESCUE', 'MILITARY EXERCISE', 'NAVAL EXERCISE',
  'NATO EXERCISE', 'ARCTIC EXERCISE', 'JOINT EXERCISE', 'EIELSON', 'JBER', 'PRUDHOE',
  'UTQIAGVIK', 'NOME', 'MINING', 'MINERALS?', 'RARE EARTH', 'CRITICAL MINERALS',
  'PROPOSED MINE', 'GOLD MINE', 'COAL MINE', 'DRILLING', 'OFFSHORE OIL', 'OIL LEASE',
  'GAS PIPELINE', 'PIPELINE', 'LNG', 'SHIPPING', 'TANKER', 'VESSEL',
  'SEAPORT', 'DEEPWATER PORT', 'PORT OF', 'WHALING', 'ILLEGAL FISHING', 'SEA ICE',
  'PERMAFROST', 'TREATY', 'SANCTION', 'EMBARGO', 'DIPLOMAT',
  'TREATIES'
];

export const THEATRES = {
  taiwan: {
    id: 'taiwan',
    dir: 'taiwan-events',
    gdelt: { fips: ['TW'], defaultGeo: 'Taiwan' },
    actorMap: [
      ['TAIWAN|TAIPEI', 'Taiwan'],
      ['CHINA|CHINESE|BEIJING|PLA', 'China'],
      ['UNITED STATES|U\\.S\\.|WASHINGTON|PENTAGON', 'United States'],
    ],
    rssFeeds: [
      {
        id: 'taipei-times', theatre: 'taiwan', name: 'Taipei Times', url: 'https://www.taipeitimes.com/xml/index.rss',
        match: ['TAIWAN', 'TAIPEI', 'CROSS-?STRAIT', 'STRAIT', '\\bPLA\\b', 'KINMEN', 'MATSU', 'PENGHU', 'TSMC', 'SEMICONDUCTOR', 'KUOMINTANG', 'CHINA', 'CHINESE', 'BEIJING', 'INVASION', 'DRILL', 'TAOYUAN', 'HSINCHU', 'TAICHUNG', 'TAINAN', 'KAOHSIUNG', 'KEELUNG', 'HUALIEN', 'CHIAYI'],
      },
      gnews('gnews-strait', 'taiwan', 'Taiwan Strait China PLA'),
      gnews('gnews-defense', 'taiwan', 'Taiwan PLA military drills'),
      {
        id: 'scmp-china', theatre: 'taiwan', name: 'SCMP', url: 'https://www.scmp.com/rss/4/feed',
        match: ['TAIWAN', 'TAIPEI', 'CROSS-?STRAIT', 'STRAIT', '\\bPLA\\b', 'KINMEN', 'MATSU', 'PENGHU', 'TSMC', 'SEMICONDUCTOR', 'KUOMINTANG', 'CHINA', 'CHINESE', 'BEIJING', 'INVASION', 'DRILL', 'TAOYUAN', 'HSINCHU', 'TAICHUNG', 'TAINAN', 'KAOHSIUNG', 'KEELUNG', 'HUALIEN', 'CHIAYI', 'MILITARY', 'DEFEN[CS]E', 'NAVY', 'MISSILE', 'COAST GUARD', 'ADIZ', 'HAN KUANG'],
      },
      {
        id: 'dw-asia', theatre: 'taiwan', name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-asia',
        match: ['TAIWAN', 'TAIPEI', 'CROSS-?STRAIT', 'STRAIT', '\\bPLA\\b', 'KINMEN', 'MATSU', 'PENGHU', 'TSMC', 'SEMICONDUCTOR', 'KUOMINTANG', 'CHINA', 'CHINESE', 'BEIJING', 'INVASION', 'DRILL', 'TAOYUAN', 'HSINCHU', 'TAICHUNG', 'TAINAN', 'KAOHSIUNG', 'KEELUNG', 'HUALIEN', 'CHIAYI', 'MILITARY', 'DEFEN[CS]E', 'NAVY', 'MISSILE', 'COAST GUARD', 'ADIZ', 'HAN KUANG'],
      },
      {
        id: 'st-asia', theatre: 'taiwan', name: 'Straits Times', url: 'https://www.straitstimes.com/news/asia/rss.xml',
        match: ['TAIWAN', 'TAIPEI', 'CROSS-?STRAIT', 'STRAIT', '\\bPLA\\b', 'KINMEN', 'MATSU', 'PENGHU', 'TSMC', 'SEMICONDUCTOR', 'KUOMINTANG', 'CHINA', 'CHINESE', 'BEIJING', 'INVASION', 'DRILL', 'TAOYUAN', 'HSINCHU', 'TAICHUNG', 'TAINAN', 'KAOHSIUNG', 'KEELUNG', 'HUALIEN', 'CHIAYI', 'MILITARY', 'DEFEN[CS]E', 'NAVY', 'MISSILE', 'COAST GUARD', 'ADIZ', 'HAN KUANG'],
      },
      gnews('gnews-arms', 'taiwan', 'Taiwan US arms sale'),
      gnews('gnews-kinmen', 'taiwan', 'Kinmen Matsu Taiwan coast guard'),
      gnews('gnews-hankuang', 'taiwan', 'Taiwan Han Kuang military drills'),
    ],
    reliefwebIso3: ['twn'],
    osm: { countryCodes: ['tw', 'cn'], bbox: [20.5, 116.5, 27.5, 124.5] },
    outletsToStrip: ['Taipei Times'],
    gazetteer: [
      { names: ['Taipei'], lat: 25.03, lng: 121.57, label: 'Taipei', level: 'city', capital: true },
      { names: ['Kaohsiung'], lat: 22.63, lng: 120.31, label: 'Kaohsiung', level: 'city' },
      { names: ['Taichung'], lat: 24.14, lng: 120.68, label: 'Taichung', level: 'city' },
      { names: ['Tainan'], lat: 22.99, lng: 120.23, label: 'Tainan', level: 'city' },
      { names: ['Taoyuan'], lat: 24.99, lng: 121.31, label: 'Taoyuan', level: 'city' },
      { names: ['Hsinchu'], lat: 24.81, lng: 120.97, label: 'Hsinchu', level: 'city' },
      { names: ['Keelung', 'Jilong'], lat: 25.13, lng: 121.74, label: 'Keelung', level: 'city' },
      { names: ['Chiayi'], lat: 23.48, lng: 120.45, label: 'Chiayi', level: 'city' },
      { names: ['Hualien'], lat: 23.97, lng: 121.6, label: 'Hualien', level: 'city' },
      { names: ['Kinmen', 'Quemoy'], lat: 24.44, lng: 118.33, label: 'Kinmen', level: 'city' },
      { names: ['Matsu'], lat: 26.16, lng: 119.95, label: 'Matsu', level: 'city' },
      { names: ['Penghu', 'Pescadores'], lat: 23.57, lng: 119.59, label: 'Penghu', level: 'city' },
      { names: ['Taiwan Strait'], lat: 24.5, lng: 119.5, label: 'Taiwan Strait', level: 'region' },
    ],
  },
  gaza: {
    id: 'gaza',
    dir: 'gaza-events',
    gdelt: { fips: ['GZ', 'WE', 'IS'], defaultGeo: 'Gaza' },
    actorMap: [
      ['ISRAEL|IDF|TEL AVIV|NETANYAHU', 'Israel'],
      ['HAMAS|GAZA|PALESTIN', 'Palestinians'],
      ['HEZBOLLAH', 'Hezbollah'],
      ['UNITED STATES|U\\.S\\.', 'United States'],
    ],
    rssFeeds: [
      {
        id: 'bbc-me', theatre: 'gaza', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
        match: GAZA_MATCH,
      },
      {
        id: 'jpost', theatre: 'gaza', name: 'Jerusalem Post', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',
        match: ['\\bIDF\\b', 'GAZA', 'HAMAS', 'NETANYAHU', 'ISRAEL', 'JERUSALEM', 'TEL AVIV', 'WEST BANK', 'HEZBOLLAH', 'HOSTAGE', 'CEASEFIRE', 'PALESTIN', 'HOUTHI', 'KNESSET', 'RAFAH', 'JENIN', 'NABLUS', 'RAMALLAH', 'HEBRON', 'BEERSHEBA', 'ASHKELON', 'SDEROT', 'HAIFA', 'EILAT', 'LEBANON', 'SYRIA'],
      },
      gnews('gnews-gaza', 'gaza', 'Gaza Israel Hamas'),
      gnews('gnews-ceasefire', 'gaza', 'Gaza ceasefire hostages aid'),
      {
        id: 'aljazeera', theatre: 'gaza', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml',
        match: GAZA_MATCH,
      },
      {
        id: 'guardian-me', theatre: 'gaza', name: 'Guardian Middle East', url: 'https://www.theguardian.com/world/middleeast/rss',
        match: GAZA_MATCH,
      },
      {
        id: 'nyt-me', theatre: 'gaza', name: 'NYT Middle East', url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml',
        match: GAZA_MATCH,
      },
      gnews('gnews-flotilla', 'gaza', 'Gaza aid flotilla Rafah crossing'),
      gnews('gnews-westbank', 'gaza', 'West Bank Jenin raid settlers'),
      gnews('gnews-lebanon', 'gaza', 'Israel Hezbollah Lebanon ceasefire'),
    ],
    reliefwebIso3: ['pse', 'isr'],
    osm: { countryCodes: ['ps', 'il'], bbox: [29.0, 32.0, 34.0, 37.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Gaza City', 'Gaza'], lat: 31.5, lng: 34.47, label: 'Gaza City', level: 'city' },
      { names: ['Rafah'], lat: 31.29, lng: 34.24, label: 'Rafah', level: 'city' },
      { names: ['Khan Younis', 'Khan Yunis'], lat: 31.34, lng: 34.31, label: 'Khan Younis', level: 'city' },
      { names: ['Jabalia', 'Jabaliya'], lat: 31.53, lng: 34.48, label: 'Jabalia', level: 'city' },
      { names: ['Deir al-Balah', 'Deir al Balah'], lat: 31.42, lng: 34.35, label: 'Deir al-Balah', level: 'city' },
      { names: ['Beit Hanoun'], lat: 31.54, lng: 34.53, label: 'Beit Hanoun', level: 'city' },
      { names: ['Nuseirat'], lat: 31.45, lng: 34.39, label: 'Nuseirat', level: 'city' },
      { names: ['Ramallah'], lat: 31.9, lng: 35.2, label: 'Ramallah', level: 'city' },
      { names: ['Nablus'], lat: 32.22, lng: 35.26, label: 'Nablus', level: 'city' },
      { names: ['Jenin'], lat: 32.46, lng: 35.29, label: 'Jenin', level: 'city' },
      { names: ['Hebron'], lat: 31.53, lng: 35.09, label: 'Hebron', level: 'city' },
      { names: ['Jerusalem'], lat: 31.77, lng: 35.21, label: 'Jerusalem', level: 'city', capital: true },
      { names: ['Tel Aviv'], lat: 32.08, lng: 34.78, label: 'Tel Aviv', level: 'city' },
      { names: ['Ashkelon'], lat: 31.67, lng: 34.57, label: 'Ashkelon', level: 'city' },
      { names: ['Sderot'], lat: 31.52, lng: 34.59, label: 'Sderot', level: 'city' },
      { names: ['Haifa'], lat: 32.82, lng: 34.99, label: 'Haifa', level: 'city' },
      { names: ['West Bank'], lat: 31.9, lng: 35.25, label: 'West Bank', level: 'region' },
    ],
  },
  iran: {
    id: 'iran',
    dir: 'iran-events',
    gdelt: { fips: ['IR'], defaultGeo: 'Iran' },
    actorMap: [
      ['IRAN|TEHRAN|IRGC|KHAMENEI', 'Iran'],
      ['ISRAEL|IDF', 'Israel'],
      ['UNITED STATES|U\\.S\\.|WASHINGTON', 'United States'],
      ['HOUTHI|YEMEN', 'Houthis'],
    ],
    rssFeeds: [
      gnews('gnews-iran', 'iran', 'Iran Hormuz nuclear'),
      gnews('gnews-unrest', 'iran', 'Iran protests Khamenei'),
      gnews('gnews-policy', 'iran', 'Tehran sanctions oil'),
      {
        id: 'iranintl', theatre: 'iran', name: 'Iran International', url: 'https://www.iranintl.com/en/feed',
        match: ['IRAN', 'TEHRAN', 'IRGC', 'KHAMENEI', 'PEZESHKIAN', 'ARAGHCHI', 'HORMUZ', 'NUCLEAR', 'NATANZ', 'FORDOW', 'ISFAHAN', 'QOM', 'BUSHEHR', 'BANDAR ABBAS', 'KARAJ', 'TABRIZ', 'MASHHAD', 'SHIRAZ', 'AHVAZ', 'KERMAN', 'SANCTION', 'ENRICHMENT', 'IAEA', 'CENTRIFUGE', 'MISSILE', 'DRONE', 'PROTEST'],
      },
      {
        id: 'tehrantimes', theatre: 'iran', name: 'Tehran Times', url: 'https://www.tehrantimes.com/rss',
        match: ['IRAN', 'TEHRAN', 'IRGC', 'KHAMENEI', 'PEZESHKIAN', 'ARAGHCHI', 'HORMUZ', 'NUCLEAR', 'NATANZ', 'FORDOW', 'ISFAHAN', 'QOM', 'BUSHEHR', 'BANDAR ABBAS', 'KARAJ', 'TABRIZ', 'MASHHAD', 'SHIRAZ', 'AHVAZ', 'KERMAN', 'SANCTION', 'ENRICHMENT', 'IAEA', 'CENTRIFUGE', 'MISSILE', 'DRONE', 'PROTEST'],
      },
      {
        id: 'irna-en', theatre: 'iran', name: 'IRNA English', url: 'https://en.irna.ir/rss',
        match: ['IRAN', 'TEHRAN', 'IRGC', 'KHAMENEI', 'PEZESHKIAN', 'ARAGHCHI', 'HORMUZ', 'NUCLEAR', 'NATANZ', 'FORDOW', 'ISFAHAN', 'QOM', 'BUSHEHR', 'BANDAR ABBAS', 'KARAJ', 'TABRIZ', 'MASHHAD', 'SHIRAZ', 'AHVAZ', 'KERMAN', 'SANCTION', 'ENRICHMENT', 'IAEA', 'CENTRIFUGE', 'MISSILE', 'DRONE', 'PROTEST'],
      },
      {
        id: 'mehr-en', theatre: 'iran', name: 'Mehr News English', url: 'https://en.mehrnews.com/rss',
        match: ['IRAN', 'TEHRAN', 'IRGC', 'KHAMENEI', 'PEZESHKIAN', 'ARAGHCHI', 'HORMUZ', 'NUCLEAR', 'NATANZ', 'FORDOW', 'ISFAHAN', 'QOM', 'BUSHEHR', 'BANDAR ABBAS', 'KARAJ', 'TABRIZ', 'MASHHAD', 'SHIRAZ', 'AHVAZ', 'KERMAN', 'SANCTION', 'ENRICHMENT', 'IAEA', 'CENTRIFUGE', 'MISSILE', 'DRONE', 'PROTEST'],
      },
      gnews('gnews-irgc', 'iran', 'Iran IRGC missile strike Israel'),
      gnews('gnews-natanz', 'iran', 'Iran Natanz Fordow enrichment IAEA'),
    ],
    reliefwebIso3: ['irn'],
    osm: { countryCodes: ['ir'], bbox: [24.0, 43.0, 41.0, 65.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Tehran'], lat: 35.69, lng: 51.39, label: 'Tehran', level: 'city', capital: true },
      { names: ['Karaj'], lat: 35.84, lng: 51.0, label: 'Karaj', level: 'city' },
      { names: ['Isfahan', 'Esfahan'], lat: 32.65, lng: 51.68, label: 'Isfahan', level: 'city' },
      { names: ['Natanz'], lat: 33.51, lng: 51.92, label: 'Natanz', level: 'city' },
      { names: ['Fordow', 'Fordow'], lat: 34.88, lng: 50.99, label: 'Fordow', level: 'city' },
      { names: ['Qom'], lat: 34.64, lng: 50.88, label: 'Qom', level: 'city' },
      { names: ['Tabriz'], lat: 38.08, lng: 46.29, label: 'Tabriz', level: 'city' },
      { names: ['Mashhad'], lat: 36.26, lng: 59.62, label: 'Mashhad', level: 'city' },
      { names: ['Shiraz'], lat: 29.59, lng: 52.59, label: 'Shiraz', level: 'city' },
      { names: ['Ahvaz', 'Ahwaz'], lat: 31.32, lng: 48.69, label: 'Ahvaz', level: 'city' },
      { names: ['Bushehr'], lat: 28.92, lng: 50.83, label: 'Bushehr', level: 'city' },
      { names: ['Bandar Abbas'], lat: 27.19, lng: 56.27, label: 'Bandar Abbas', level: 'city' },
      { names: ['Kermanshah'], lat: 34.31, lng: 47.06, label: 'Kermanshah', level: 'city' },
      { names: ['Urmia'], lat: 37.55, lng: 45.07, label: 'Urmia', level: 'city' },
      { names: ['Strait of Hormuz', 'Hormuz Strait'], lat: 26.57, lng: 56.25, label: 'Strait of Hormuz', level: 'region' },
    ],
  },
  sahel: {
    id: 'sahel',
    dir: 'sahel-events',
    gdelt: { fips: ['ML', 'UV', 'NG'], defaultGeo: 'Sahel' },
    actorMap: [
      ['MALI|BAMAKO|JUNTA', 'Mali'],
      ['BURKINA|OUAGADOUGOU', 'Burkina Faso'],
      ['NIGER|NIAMEY', 'Niger'],
      ['RUSSIA|WAGNER|AFRICA CORPS', 'Russia / Africa Corps'],
      ['FRANCE|FRENCH', 'France'],
      ['UNITED STATES|U\\.S\\.|AFRICOM', 'United States'],
      ['JNIM|AL QAEDA|QAEDA|ISLAMIC STATE|ISIS|ISGS|ISWAP|BOKO', 'Jihadist groups'],
    ],
    rssFeeds: [
      {
        id: 'aa-mali', theatre: 'sahel', name: 'AllAfrica Mali', url: 'https://allafrica.com/tools/headlines/rdf/mali/headlines.rdf',
        match: SAHEL_CRISIS_MATCH,
      },
      {
        id: 'aa-burkina', theatre: 'sahel', name: 'AllAfrica Burkina Faso', url: 'https://allafrica.com/tools/headlines/rdf/burkinafaso/headlines.rdf',
        match: SAHEL_CRISIS_MATCH,
      },
      {
        id: 'aa-niger', theatre: 'sahel', name: 'AllAfrica Niger', url: 'https://allafrica.com/tools/headlines/rdf/niger/headlines.rdf',
        match: SAHEL_CRISIS_MATCH,
      },
      gnews('gnews-sahel', 'sahel', 'Sahel Mali Burkina Niger'),
      {
        id: 'rfi-africa', theatre: 'sahel', name: 'RFI Africa', url: 'https://www.rfi.fr/en/africa/rss',
        match: ['\\bMALI\\b', 'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA', 'MÉNAKA', 'TESSALIT', 'BURKINA', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b', 'OUAHIGOUYA', '\\bNIGER\\b', 'NIGERIEN', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA', 'TAHOUA', 'SAHEL', 'JNIM', 'QAEDA', 'ISGS', 'ISWAP', 'BOKO HARAM', 'JIHAD', 'TUAREG', 'WAGNER', 'AFRICA CORPS', '\\bAES\\b'],
      },
      {
        id: 'france24-africa', theatre: 'sahel', name: 'France 24 Africa', url: 'https://www.france24.com/en/africa/rss',
        match: ['\\bMALI\\b', 'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA', 'MÉNAKA', 'TESSALIT', 'BURKINA', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b', 'OUAHIGOUYA', '\\bNIGER\\b', 'NIGERIEN', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA', 'TAHOUA', 'SAHEL', 'JNIM', 'QAEDA', 'ISGS', 'ISWAP', 'BOKO HARAM', 'JIHAD', 'TUAREG', 'WAGNER', 'AFRICA CORPS', '\\bAES\\b'],
      },
      {
        id: 'bbc-africa', theatre: 'sahel', name: 'BBC Africa', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',
        match: ['\\bMALI\\b', 'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA', 'MÉNAKA', 'TESSALIT', 'BURKINA', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b', 'OUAHIGOUYA', '\\bNIGER\\b', 'NIGERIEN', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA', 'TAHOUA', 'SAHEL', 'JNIM', 'QAEDA', 'ISGS', 'ISWAP', 'BOKO HARAM', 'JIHAD', 'TUAREG', 'WAGNER', 'AFRICA CORPS', '\\bAES\\b'],
      },
      {
        id: 'africanews', theatre: 'sahel', name: 'Africanews', url: 'https://www.africanews.com/feed/',
        match: ['\\bMALI\\b', 'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA', 'MÉNAKA', 'TESSALIT', 'BURKINA', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b', 'OUAHIGOUYA', '\\bNIGER\\b', 'NIGERIEN', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA', 'TAHOUA', 'SAHEL', 'JNIM', 'QAEDA', 'ISGS', 'ISWAP', 'BOKO HARAM', 'JIHAD', 'TUAREG', 'WAGNER', 'AFRICA CORPS', '\\bAES\\b'],
      },
      {
        id: 'dw-africa', theatre: 'sahel', name: 'DW Africa', url: 'https://rss.dw.com/xml/rss-en-africa',
        match: ['\\bMALI\\b', 'BAMAKO', '\\bGAO\\b', 'KIDAL', 'TIMBUKTU', 'MOPTI', 'MENAKA', 'MÉNAKA', 'TESSALIT', 'BURKINA', 'OUAGADOUGOU', '\\bKAYA\\b', '\\bDJIBO\\b', '\\bDORI\\b', 'OUAHIGOUYA', '\\bNIGER\\b', 'NIGERIEN', 'NIAMEY', 'AGADEZ', 'TILLABERI', 'TILLABÉRI', 'DIFFA', 'TAHOUA', 'SAHEL', 'JNIM', 'QAEDA', 'ISGS', 'ISWAP', 'BOKO HARAM', 'JIHAD', 'TUAREG', 'WAGNER', 'AFRICA CORPS', '\\bAES\\b'],
      },
      gnews('gnews-jnim', 'sahel', 'Mali Bamako JNIM attack'),
      gnews('gnews-burkina', 'sahel', 'Burkina Faso junta attack'),
      gnews('gnews-niger', 'sahel', 'Niger Niamey AES junta'),
    ],
    reliefwebIso3: ['mli', 'bfa', 'ner'],
    osm: { countryCodes: ['ml', 'bf', 'ne'], bbox: [7.0, -19.0, 26.0, 39.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Bamako'], lat: 12.64, lng: -8.0, label: 'Bamako', level: 'city', capital: true },
      { names: ['Gao'], lat: 16.27, lng: -0.04, label: 'Gao', level: 'city' },
      { names: ['Kidal'], lat: 18.44, lng: 1.41, label: 'Kidal', level: 'city' },
      { names: ['Timbuktu', 'Tombouctou'], lat: 16.77, lng: -3.0, label: 'Timbuktu', level: 'city' },
      { names: ['Mopti'], lat: 14.49, lng: -4.2, label: 'Mopti', level: 'city' },
      { names: ['Menaka', 'Ménaka'], lat: 15.92, lng: 2.4, label: 'Menaka', level: 'city' },
      { names: ['Tessalit'], lat: 20.2, lng: 1.0, label: 'Tessalit', level: 'city' },
      { names: ['Ouagadougou'], lat: 12.37, lng: -1.53, label: 'Ouagadougou', level: 'city', capital: true },
      { names: ['Kaya'], lat: 13.09, lng: -1.08, label: 'Kaya', level: 'city' },
      { names: ['Djibo'], lat: 14.1, lng: -1.63, label: 'Djibo', level: 'city' },
      { names: ['Dori'], lat: 14.03, lng: -0.03, label: 'Dori', level: 'city' },
      { names: ['Ouahigouya'], lat: 13.58, lng: -2.42, label: 'Ouahigouya', level: 'city' },
      { names: ['Niamey'], lat: 13.51, lng: 2.11, label: 'Niamey', level: 'city', capital: true },
      { names: ['Agadez'], lat: 16.97, lng: 7.99, label: 'Agadez', level: 'city' },
      { names: ['Tillaberi', 'Tillabéri'], lat: 14.21, lng: 1.45, label: 'Tillaberi', level: 'city' },
      { names: ['Diffa'], lat: 13.32, lng: 12.62, label: 'Diffa', level: 'city' },
      { names: ['Tahoua'], lat: 14.89, lng: 5.27, label: 'Tahoua', level: 'city' },
    ],
  },
  korea: {
    id: 'korea',
    dir: 'korea-events',
    gdelt: { fips: ['KN', 'KS'], defaultGeo: 'Korea' },
    actorMap: [
      ['NORTH KOREA|DPRK|PYONGYANG|KIM JONG', 'North Korea'],
      ['SOUTH KOREA|\\bROK\\b|SEOUL|LEE JAE', 'South Korea'],
      ['UNITED STATES|U\\.S\\.', 'United States'],
      ['CHINA|BEIJING', 'China'],
    ],
    rssFeeds: [
      { id: 'yna-nk', theatre: 'korea', name: 'Yonhap', url: 'https://en.yna.co.kr/RSS/nk.xml' },
      {
        id: 'yna-news', theatre: 'korea', name: 'Yonhap', url: 'https://en.yna.co.kr/RSS/news.xml',
        match: ['KOREA', 'SEOUL', 'PYONGYANG', 'MISSILE', 'DMZ', 'NUCLEAR', '\\bKIM\\b', 'KAESONG', 'WONSAN', 'BUSAN', 'INCHEON', 'PYEONGTAEK', 'OSAN', 'DAEGU', 'TAEGU', 'JEJU', 'JCS', 'Yoon', 'DEFECTOR', 'ABDUCTEE'],
      },
      {
        id: 'korea-times', theatre: 'korea', name: 'Korea Times', url: 'https://feed.koreatimes.co.kr/k/allnews.xml',
        match: ['KOREA', 'SEOUL', 'PYONGYANG', 'MISSILE', 'DMZ', 'NUCLEAR', '\\bKIM\\b', 'KAESONG', 'WONSAN', 'BUSAN', 'INCHEON', 'PYEONGTAEK', 'OSAN', 'DAEGU', 'TAEGU', 'JEJU', 'JCS', 'Yoon', 'DEFECTOR', 'ABDUCTEE'],
      },
      gnews('gnews-korea', 'korea', 'North Korea missile Kim'),
      { id: 'nknews', theatre: 'korea', name: 'NK News', url: 'https://www.nknews.org/feed/' },
      { id: '38north', theatre: 'korea', name: '38 North', url: 'https://feeds.feedburner.com/38North' },
      {
        id: 'diplomat', theatre: 'korea', name: 'The Diplomat', url: 'https://thediplomat.com/feed/',
        match: ['KOREA', 'SEOUL', 'PYONGYANG', 'MISSILE', 'DMZ', 'NUCLEAR', '\\bKIM\\b', 'KAESONG', 'WONSAN', 'BUSAN', 'INCHEON', 'PYEONGTAEK', 'OSAN', 'DAEGU', 'TAEGU', 'JEJU', 'JCS', 'LEE JAE', 'DEFECTOR', 'ABDUCTEE'],
      },
      {
        id: 'bbc-asia', theatre: 'korea', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
        match: ['KOREA', 'SEOUL', 'PYONGYANG', 'MISSILE', 'DMZ', 'NUCLEAR', '\\bKIM\\b', 'KAESONG', 'WONSAN', 'BUSAN', 'INCHEON', 'PYEONGTAEK', 'OSAN', 'DAEGU', 'TAEGU', 'JEJU', 'JCS', 'LEE JAE', 'DEFECTOR', 'ABDUCTEE'],
      },
      gnews('gnews-missile', 'korea', 'North Korea missile launch'),
      gnews('gnews-nkru', 'korea', 'North Korea Russia troops Ukraine'),
      gnews('gnews-yongbyon', 'korea', 'North Korea Yongbyon nuclear'),
    ],
    reliefwebIso3: ['prk', 'kor'],
    osm: { countryCodes: ['kp', 'kr'], bbox: [33.0, 122.0, 44.0, 133.5] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Pyongyang'], lat: 39.03, lng: 125.75, label: 'Pyongyang', level: 'city', capital: true },
      { names: ['Seoul'], lat: 37.57, lng: 126.98, label: 'Seoul', level: 'city', capital: true },
      { names: ['Kaesong'], lat: 37.97, lng: 126.55, label: 'Kaesong', level: 'city' },
      { names: ['Wonsan'], lat: 39.15, lng: 127.45, label: 'Wonsan', level: 'city' },
      { names: ['Hamhung'], lat: 39.92, lng: 127.53, label: 'Hamhung', level: 'city' },
      { names: ['Chongjin'], lat: 41.78, lng: 129.72, label: 'Chongjin', level: 'city' },
      { names: ['Nampo'], lat: 38.73, lng: 125.41, label: 'Nampo', level: 'city' },
      { names: ['Sinuiju'], lat: 40.11, lng: 124.4, label: 'Sinuiju', level: 'city' },
      { names: ['Panmunjom', 'Panmunjeom'], lat: 38.32, lng: 126.9, label: 'Panmunjom', level: 'city' },
      { names: ['Busan', 'Pusan'], lat: 35.18, lng: 129.08, label: 'Busan', level: 'city' },
      { names: ['Incheon', 'Inchon'], lat: 37.46, lng: 126.71, label: 'Incheon', level: 'city' },
      { names: ['Pyeongtaek'], lat: 36.99, lng: 126.83, label: 'Pyeongtaek', level: 'city' },
      { names: ['Osan'], lat: 37.15, lng: 127.08, label: 'Osan', level: 'city' },
      { names: ['Daegu', 'Taegu'], lat: 35.87, lng: 128.6, label: 'Daegu', level: 'city' },
      { names: ['DMZ', 'Demilitarized Zone'], lat: 38.32, lng: 127.0, label: 'DMZ', level: 'region' },
    ],
  },
  arctic: {
    id: 'arctic',
    dir: 'arctic-events',
    // No single FIPS: polar bbox over the site's theatre envelope instead.
    gdelt: { bbox: [58.0, -75.0, 84.0, 35.0], defaultGeo: 'Arctic' },
    actorMap: [
      ['RUSSIA|RUSSIAN|MOSCOW', 'Russia'],
      ['UNITED STATES|U\\.S\\.|WASHINGTON', 'United States'],
      ['CHINA|BEIJING', 'China'],
      ['GREENLAND|NUUK|DENMARK|DANISH', 'Greenland / Denmark'],
      ['NORWAY|OSLO', 'Norway'],
      ['CANADA|OTTAWA', 'Canada'],
    ],
    rssFeeds: [
      {
        id: 'rci-arctic', theatre: 'arctic', name: 'Eye on the Arctic', url: 'https://www.rcinet.ca/eye-on-the-arctic/feed/',
        match: ARCTIC_WATCH_MATCH,
      },
      gnews('gnews-arctic', 'arctic', 'Arctic Greenland'),
      { id: 'guardian-arctic', theatre: 'arctic', name: 'Guardian Arctic', url: 'https://www.theguardian.com/world/arctic/rss' },
      {
        id: 'adn-alaska', theatre: 'arctic', name: 'Anchorage Daily News', url: 'https://www.adn.com/arc/outboundfeeds/rss/',
        match: ['ARCTIC', 'UTQIAGVIK', 'BARROW', 'PRUDHOE', 'NORTH SLOPE', 'NOME', 'KOTZEBUE', 'BETHEL', 'FAIRBANKS', 'BERING', 'CHUKCHI', 'BEAUFORT', 'ALEUTIAN', 'KODIAK', 'BRISTOL BAY', 'COAST GUARD', 'ICEBREAKER', 'NORTHERN SEA', 'WHALING', 'DRILLING', 'PIPELINE', 'SEARCH AND RESCUE', 'EIELSON', 'JBER', 'PITUFFIK', 'THULE', 'GREENLAND', 'RUSSIA', 'RUSSIAN', 'SUBMARINE', 'F-35', 'C-130'],
      },
      { id: 'cryopolitics', theatre: 'arctic', name: 'Cryopolitics', url: 'https://www.cryopolitics.com/feed/' },
      gnews('gnews-svalbard', 'arctic', 'Svalbard Norway Russia Arctic'),
      gnews('gnews-greenland', 'arctic', 'Greenland Nuuk Arctic military'),
      gnews('gnews-nsr', 'arctic', 'Northern Sea Route Russia Arctic'),
    ],
    reliefwebIso3: null, // multi-country polar region; RSS covers it
    osm: { countryCodes: ['ca', 'gl', 'no', 'se', 'fi', 'is', 'ru', 'us'], bbox: [55.0, -180.0, 85.0, 60.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Nuuk'], lat: 64.18, lng: -51.72, label: 'Nuuk', level: 'city' },
      { names: ['Ilulissat'], lat: 69.22, lng: -51.1, label: 'Ilulissat', level: 'city' },
      { names: ['Pituffik', 'Thule'], lat: 76.53, lng: -68.83, label: 'Pituffik', level: 'city' },
      { names: ['Longyearbyen'], lat: 78.22, lng: 15.63, label: 'Longyearbyen', level: 'city' },
      { names: ['Tromsø', 'Tromso'], lat: 69.65, lng: 18.96, label: 'Tromsø', level: 'city' },
      { names: ['Kirkenes'], lat: 69.73, lng: 30.05, label: 'Kirkenes', level: 'city' },
      { names: ['Reykjavik', 'Reykjavík'], lat: 64.15, lng: -21.94, label: 'Reykjavik', level: 'city' },
      { names: ['Iqaluit'], lat: 63.75, lng: -68.52, label: 'Iqaluit', level: 'city' },
      { names: ['Yellowknife'], lat: 62.45, lng: -114.37, label: 'Yellowknife', level: 'city' },
      { names: ['Whitehorse'], lat: 60.72, lng: -135.05, label: 'Whitehorse', level: 'city' },
      { names: ['Utqiagvik', 'Barrow'], lat: 71.29, lng: -156.79, label: 'Utqiagvik', level: 'city' },
      { names: ['Prudhoe Bay'], lat: 70.26, lng: -148.34, label: 'Prudhoe Bay', level: 'city' },
      { names: ['Murmansk'], lat: 68.96, lng: 33.09, label: 'Murmansk', level: 'city' },
      { names: ['Greenland'], lat: 72.0, lng: -40.0, label: 'Greenland', level: 'region' },
      { names: ['Svalbard'], lat: 78.5, lng: 16.0, label: 'Svalbard', level: 'region' },
      { names: ['Bering Strait'], lat: 66.0, lng: -169.0, label: 'Bering Strait', level: 'region' },
    ],
  },
  'us-election': {
    id: 'us-election',
    dir: 'us-election-events',
    // RSS-only wire (GDELT disabled 2026-10-01): a subject-matter topic has
    // no geographic signal, and GDELT rows carry no headline text, so FIPS
    // US + roots 13-17 admitted ~100/hr domestic noise rows at ~1% precision.
    // RSS headlines + keyword gates are the relevance signal here.
    gdelt: { fips: ['US'], roots: ['13', '14', '15', '16', '17'], defaultGeo: 'United States', disabled: true },
    actorMap: [
      ['TRUMP|WHITE HOUSE', 'Trump administration'],
      ['DEMOCRAT|BIDEN|HARRIS|NEWSOM|OCASIO|AOC', 'Democrats'],
      ['REPUBLICAN|\\bGOP\\b|CONGRESS', 'Republicans'],
      ['SUPREME COURT|SCOTUS|FEDERAL JUDGE|\\bCOURT\\b', 'Courts'],
    ],
    rssFeeds: [
      {
        id: 'npr-politics', theatre: 'us-election', name: 'NPR', url: 'https://feeds.npr.org/1014/rss.xml',
        match: US_POLITICS_MATCH,
      },
      { id: 'eac', theatre: 'us-election', name: 'EAC', url: 'https://www.eac.gov/rss.xml' },
      gnews('gnews-election', 'us-election', 'US election Trump 2028', US_POLITICS_MATCH),
      gnews('gnews-policy', 'us-election', 'Trump tariffs executive order', US_POLITICS_MATCH),
      {
        id: 'thehill', theatre: 'us-election', name: 'The Hill', url: 'https://thehill.com/feed/',
        match: US_POLITICS_MATCH,
      },
      {
        id: 'politico-congress', theatre: 'us-election', name: 'Politico', url: 'https://rss.politico.com/congress.xml',
        match: US_POLITICS_MATCH,
      },
      {
        id: 'pbs-politics', theatre: 'us-election', name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/politics',
        match: US_POLITICS_MATCH,
      },
      {
        id: 'rollcall-congress', theatre: 'us-election', name: 'Roll Call', url: 'https://rollcall.com/section/congress/rss',
        match: US_POLITICS_MATCH,
      },
      {
        id: 'axios', theatre: 'us-election', name: 'Axios', url: 'https://api.axios.com/feed/',
        match: US_POLITICS_MATCH,
      },
      gnews('gnews-protest', 'us-election', 'Trump protest National Guard deployment', US_POLITICS_MATCH),
      gnews('gnews-courts', 'us-election', 'federal judge blocks executive order ruling', US_POLITICS_MATCH),
      gnews('gnews-midterms', 'us-election', 'US midterm elections 2026 polls', US_POLITICS_MATCH),
    ],
    reliefwebIso3: null, // US disaster reports are not election news
    osm: { countryCodes: ['us'], bbox: [17.0, -180.0, 72.0, -64.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Washington', 'Washington DC', 'Washington D.C.'], lat: 38.9, lng: -77.04, label: 'Washington', level: 'city', capital: true },
      { names: ['New York'], lat: 40.71, lng: -74.0, label: 'New York', level: 'city' },
      { names: ['Los Angeles'], lat: 34.05, lng: -118.24, label: 'Los Angeles', level: 'city' },
      { names: ['Chicago'], lat: 41.88, lng: -87.63, label: 'Chicago', level: 'city' },
      { names: ['Houston'], lat: 29.76, lng: -95.37, label: 'Houston', level: 'city' },
      { names: ['Phoenix'], lat: 33.45, lng: -112.07, label: 'Phoenix', level: 'city' },
      { names: ['Philadelphia'], lat: 39.95, lng: -75.17, label: 'Philadelphia', level: 'city' },
      { names: ['Atlanta'], lat: 33.75, lng: -84.39, label: 'Atlanta', level: 'city' },
      { names: ['Detroit'], lat: 42.33, lng: -83.05, label: 'Detroit', level: 'city' },
      { names: ['Milwaukee'], lat: 43.04, lng: -87.91, label: 'Milwaukee', level: 'city' },
      { names: ['Pittsburgh'], lat: 40.44, lng: -79.99, label: 'Pittsburgh', level: 'city' },
      { names: ['Las Vegas'], lat: 36.17, lng: -115.14, label: 'Las Vegas', level: 'city' },
      { names: ['Madison'], lat: 43.07, lng: -89.4, label: 'Madison', level: 'city' },
      { names: ['Raleigh'], lat: 35.78, lng: -78.64, label: 'Raleigh', level: 'city' },
      { names: ['Harrisburg'], lat: 40.27, lng: -76.88, label: 'Harrisburg', level: 'city' },
    ],
  },
  // Native feeds verified live 2026-09-28 (HTTP 200 + items parsed).
  houthis: {
    id: 'houthis',
    dir: 'houthis-events',
    gdelt: { fips: ['YM'], defaultGeo: 'Yemen' },
    actorMap: [
      ['HOUTHI|ANSAR ALLAH|ABDUL[- ]MALIK|AL-HOUTHI', 'Houthis'],
      ['YEMEN|SANAA|SANA\'A|ADEN|HODEIDAH|TAIZ', 'Yemen'],
      ['UNITED STATES|U\\.S\\.|WASHINGTON|PENTAGON|CENTCOM|TRUMP', 'United States'],
      ['ISRAEL|IDF|TEL AVIV', 'Israel'],
      ['SAUDI|RIYADH', 'Saudi Arabia'],
      ['UNITED KINGDOM|BRITAIN|\\bU\\.K\\.\\b|LONDON', 'United Kingdom'],
    ],
    rssFeeds: [
      {
        id: 'gcaptain', theatre: 'houthis', name: 'gCaptain', url: 'https://gcaptain.com/feed/',
        match: ['HOUTHI', 'RED SEA', 'MANDEB', 'YEMEN', 'HODEIDAH', 'ADEN', 'TANKER', 'BULK CARRIER', 'CONTAINER ?SHIP', 'VESSEL', 'PIRACY', 'PIRATE', 'USV', 'DRONE BOAT', 'SEA DRONE', 'GALAXY LEADER', 'PROSPERITY GUARDIAN', 'SUEZ', 'STRAIT', 'GULF OF ADEN', 'BAB EL', 'MISSILE', 'HIJACK'],
      },
      {
        id: 'bbc-yemen', theatre: 'houthis', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',
        match: ['HOUTHI', 'YEMEN', 'SANAA', 'SANA\'A', 'ADEN', 'HODEIDAH', 'TAIZ', 'SAADA', 'MUKALLA', 'MARIB', 'MOKHA', 'PERIM', 'RED SEA', 'MANDEB', 'GULF OF ADEN', 'AIRSTRIKE', 'STRIKE', 'CEASEFIRE', 'BLOCKADE'],
      },
      gnews('gnews-houthis', 'houthis', 'Houthis Yemen Red Sea'),
      gnews('gnews-shipping', 'houthis', 'Red Sea shipping Houthi attack'),
      {
        id: 'splash247', theatre: 'houthis', name: 'Splash247', url: 'https://splash247.com/feed/',
        match: ['HOUTHI', 'RED SEA', 'MANDEB', 'YEMEN', 'ADEN', 'HODEIDAH', 'TANKER', 'BULK CARRIER', 'CONTAINER ?SHIP', 'VESSEL', 'PIRACY', 'PIRATE', 'DRONE BOAT', 'SEA DRONE', 'MISSILE', 'HIJACK', 'SUEZ', 'GULF OF ADEN', 'BAB EL', 'STRAIT', 'HORMUZ', 'SHADOW FLEET', 'SANCTION'],
      },
      {
        id: 'loadstar', theatre: 'houthis', name: 'The Loadstar', url: 'https://theloadstar.com/feed/',
        match: ['HOUTHI', 'RED SEA', 'MANDEB', 'YEMEN', 'ADEN', 'HODEIDAH', 'TANKER', 'BULK CARRIER', 'CONTAINER ?SHIP', 'VESSEL', 'PIRACY', 'PIRATE', 'DRONE BOAT', 'SEA DRONE', 'MISSILE', 'HIJACK', 'SUEZ', 'GULF OF ADEN', 'BAB EL', 'STRAIT', 'HORMUZ', 'SHADOW FLEET', 'SANCTION'],
      },
      {
        id: 'france24-me', theatre: 'houthis', name: 'France 24 Middle East', url: 'https://www.france24.com/en/middle-east/rss',
        match: ['HOUTHI', 'YEMEN', 'SANAA', 'SANA\'A', 'ADEN', 'HODEIDAH', 'TAIZ', 'SAADA', 'MUKALLA', 'MARIB', 'RED SEA', 'MANDEB', 'GULF OF ADEN', 'AIRSTRIKE', 'CEASEFIRE', 'BLOCKADE', 'SAUDI', 'EMIRATI'],
      },
      gnews('gnews-hodeidah', 'houthis', 'Hodeidah Sanaa airstrike Houthi'),
      gnews('gnews-mandeb', 'houthis', 'Bab el-Mandeb vessel drone attack'),
    ],
    reliefwebIso3: ['yem'],
    osm: { countryCodes: ['ye'], bbox: [10.5, 38.0, 20.0, 56.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Sanaa', 'Sana\'a'], lat: 15.35, lng: 44.21, label: 'Sanaa', level: 'city', capital: true },
      { names: ['Hodeidah', 'Hudaydah', 'Al Hudaydah'], lat: 14.8, lng: 42.95, label: 'Hodeidah', level: 'city' },
      { names: ['Aden'], lat: 12.78, lng: 45.04, label: 'Aden', level: 'city' },
      { names: ['Taiz', 'Ta\'izz'], lat: 13.58, lng: 44.02, label: 'Taiz', level: 'city' },
      { names: ['Saada', 'Sa\'dah'], lat: 16.94, lng: 43.77, label: 'Saada', level: 'city' },
      { names: ['Mukalla', 'Al Mukalla'], lat: 14.53, lng: 49.13, label: 'Mukalla', level: 'city' },
      { names: ['Marib', 'Ma\'rib'], lat: 15.47, lng: 45.33, label: 'Marib', level: 'city' },
      { names: ['Mokha', 'Mocha'], lat: 13.32, lng: 43.25, label: 'Mokha', level: 'city' },
      { names: ['Perim Island', 'Perim', 'Mayyun'], lat: 12.66, lng: 43.42, label: 'Perim Island', level: 'city' },
      { names: ['Bab el-Mandeb', 'Bab el Mandeb', 'Mandeb'], lat: 12.6, lng: 43.4, label: 'Bab el-Mandeb', level: 'region' },
      { names: ['Red Sea'], lat: 15.5, lng: 41.5, label: 'Red Sea', level: 'region' },
      { names: ['Gulf of Aden'], lat: 13.0, lng: 47.5, label: 'Gulf of Aden', level: 'region' },
    ],
  },
  // Native feeds verified live 2026-10-01 (HTTP 200 + parsed + dated; Mizzima/Frontier 403 bot-walled, dropped).
  myanmar: {
    id: 'myanmar',
    dir: 'myanmar-events',
    gdelt: { fips: ['BM'], defaultGeo: 'Myanmar' },
    actorMap: [
      ['TATMADAW|MYANMAR MILITARY|JUNTA|\\bSAC\\b|MIN AUNG HLAING|STATE ADMINISTRATION', 'Myanmar junta'],
      ['\\bNUG\\b|NATIONAL UNITY|\\bPDF\\b|PEOPLE.?S DEFEN[CS]E|RESISTANCE', 'Resistance (NUG/PDF)'],
      ['ARAKAN ARMY|KACHIN|\\bKNU\\b|KAREN NATIONAL|TNLA|MNDAA|UNITED WA|\\bUWSA\\b|SHAN STATE ARMY|CHIN NATIONAL|KARENNI', 'Ethnic armed groups'],
      ['CHINA|CHINESE|BEIJING', 'China'],
      ['ROHINGYA', 'Rohingya'],
    ],
    rssFeeds: [
      { id: 'irrawaddy', theatre: 'myanmar', name: 'The Irrawaddy', url: 'https://www.irrawaddy.com/feed' },
      { id: 'myanmar-now', theatre: 'myanmar', name: 'Myanmar Now', url: 'https://myanmar-now.org/en/feed/' },
      { id: 'dvb', theatre: 'myanmar', name: 'DVB English', url: 'https://english.dvb.no/feed/' },
      {
        id: 'bbc-myanmar', theatre: 'myanmar', name: 'BBC Asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
        match: ['MYANMAR', 'BURMA', 'BURMESE', 'NAYPYIDAW', 'YANGON', 'MANDALAY', 'RAKHINE', 'ARAKAN', 'ROHINGYA', 'TATMADAW', 'MIN AUNG HLAING', 'AUNG SAN SUU KYI', 'KACHIN', '\\bKNU\\b', 'KARENNI', 'SAGAING', 'MAGWAY', 'TANINTHARYI', 'MON STATE', 'CHIN STATE', 'KAYAH', 'SHAN STATE', 'IRRAWADDY', 'SITTWE', 'LASHIO', 'MYAWADDY', 'MOGOK', 'BHAMO', 'KYAUKTAW', 'MONGMIT', 'KYAUKME', 'DAWEI', 'MYITKYINA', 'TAUNGGYI', 'MEIKTILA', 'PYINMANA'],
      },
      gnews('gnews-myanmar', 'myanmar', 'Myanmar'),
      gnews('gnews-war', 'myanmar', 'Myanmar civil war'),
      gnews('gnews-rakhine', 'myanmar', 'Rakhine Arakan Army'),
    ],
    reliefwebIso3: ['mmr'],
    osm: { countryCodes: ['mm'], bbox: [9.0, 92.0, 29.0, 102.0] },
    outletsToStrip: [],
    gazetteer: [
      { names: ['Naypyidaw', 'Nay Pyi Taw'], lat: 19.76, lng: 96.07, label: 'Naypyidaw', level: 'city', capital: true },
      { names: ['Yangon', 'Rangoon'], lat: 16.84, lng: 96.17, label: 'Yangon', level: 'city' },
      { names: ['Mandalay'], lat: 21.97, lng: 96.08, label: 'Mandalay', level: 'city' },
      { names: ['Mawlamyine', 'Moulmein'], lat: 16.49, lng: 97.63, label: 'Mawlamyine', level: 'city' },
      { names: ['Myitkyina'], lat: 25.38, lng: 97.40, label: 'Myitkyina', level: 'city' },
      { names: ['Lashio'], lat: 22.93, lng: 97.75, label: 'Lashio', level: 'city' },
      { names: ['Taunggyi'], lat: 20.78, lng: 97.04, label: 'Taunggyi', level: 'city' },
      { names: ['Sittwe'], lat: 20.15, lng: 92.90, label: 'Sittwe', level: 'city' },
      { names: ['Myawaddy'], lat: 16.69, lng: 98.51, label: 'Myawaddy', level: 'city' },
      { names: ['Hpa-an', 'Hpa An', 'Pa-an'], lat: 16.89, lng: 97.63, label: 'Hpa-an', level: 'city' },
      { names: ['Kalay', 'Kalaymyo'], lat: 23.19, lng: 94.06, label: 'Kalay', level: 'city' },
      { names: ['Bhamo'], lat: 24.26, lng: 97.24, label: 'Bhamo', level: 'city' },
      { names: ['Mogok'], lat: 22.92, lng: 96.51, label: 'Mogok', level: 'city' },
      { names: ['Dawei', 'Tavoy'], lat: 14.08, lng: 98.19, label: 'Dawei', level: 'city' },
      { names: ['Rakhine State', 'Rakhine'], lat: 20.50, lng: 93.00, label: 'Rakhine State', level: 'region' },
      { names: ['Sagaing Region', 'Sagaing'], lat: 22.00, lng: 95.50, label: 'Sagaing Region', level: 'region' },
      { names: ['Shan State'], lat: 21.50, lng: 98.00, label: 'Shan State', level: 'region' },
    ],
  },
  france: {
    id: 'france',
    dir: 'france-events',
    gdelt: { fips: ['FR'], defaultGeo: 'France' },
    actorMap: [
      ['USL|UNION SYNDICALE|RYAD RANI', 'Student unions'],
      ['LA FRANCE INSOUMISE|\\bLFI\\b|MÉLENCHON|MELENCHON|BOMPARD|BAGAYOKO', 'Left bloc'],
      ['LECORNU|GEFFRAY|NUÑEZ|NUNEZ|DARMANIN|RETAILLEAU|ATTAL|PÉCRESSE|PECRESSE', 'Government'],
      ['POLICE|GENDARMERIE|\\bCRS\\b|PREFECT', 'Security forces'],
    ],
    // RSS verified 2026-10-03: gnews-france-protests 50/50 (46 fresh72h),
    // gnews-lycees 34/34 (17 fresh72h); outlet gates via FRANCE_MATCH above.
    rssFeeds: [
      gnews('gnews-france-protests', 'france', 'France student protests'),
      gnews('gnews-lycees', 'france', 'France lycées blockades'),
      {
        id: 'france24-en', theatre: 'france', name: 'France 24 English', url: 'https://www.france24.com/en/rss',
        match: FRANCE_MATCH,
      },
      {
        id: 'bbc-france', theatre: 'france', name: 'BBC Europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
        match: FRANCE_MATCH,
      },
      {
        id: 'rfi-en', theatre: 'france', name: 'RFI English', url: 'https://www.rfi.fr/en/rss',
        match: FRANCE_MATCH,
      },
    ],
    reliefwebIso3: ['fra'],
    osm: { countryCodes: ['fr'], bbox: [41.0, -5.5, 51.5, 10.0] },
    gazetteer: [
      { names: ['Paris'], lat: 48.86, lng: 2.35, label: 'Paris', level: 'city', capital: true },
      { names: ['Créteil', 'Creteil'], lat: 48.79, lng: 2.45, label: 'Créteil', level: 'city' },
      { names: ['Saint-Denis'], lat: 48.94, lng: 2.36, label: 'Saint-Denis', level: 'city' },
      { names: ['Pantin'], lat: 48.9, lng: 2.41, label: 'Pantin', level: 'city' },
      { names: ['Lille'], lat: 50.63, lng: 3.07, label: 'Lille', level: 'city' },
      { names: ['Lyon'], lat: 45.76, lng: 4.84, label: 'Lyon', level: 'city' },
      { names: ['Marseille'], lat: 43.3, lng: 5.37, label: 'Marseille', level: 'city' },
      { names: ['Nantes'], lat: 47.22, lng: -1.55, label: 'Nantes', level: 'city' },
      { names: ['Rennes'], lat: 48.11, lng: -1.68, label: 'Rennes', level: 'city' },
      { names: ['Bordeaux'], lat: 44.84, lng: -0.58, label: 'Bordeaux', level: 'city' },
      { names: ['Toulouse'], lat: 43.6, lng: 1.44, label: 'Toulouse', level: 'city' },
      { names: ['Strasbourg'], lat: 48.57, lng: 7.75, label: 'Strasbourg', level: 'city' },
      { names: ['Nice'], lat: 43.7, lng: 7.27, label: 'Nice', level: 'city' },
      { names: ['Montpellier'], lat: 43.61, lng: 3.88, label: 'Montpellier', level: 'city' },
    ],
  },
};

export const THEATRE_IDS = Object.keys(THEATRES);

export function getTheatre(id) {
  const t = THEATRES[id];
  if (!t) throw new Error(`unknown theatre "${id}" (expected one of: ${THEATRE_IDS.join(', ')})`);
  return t;
}
