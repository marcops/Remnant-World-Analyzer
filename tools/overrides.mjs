// Manual fixes applied on top of the automatic name-matching in build-data.mjs.
// Keys are "Category|Exact sheet name".
//
// MANUAL_KEYS: force (or explicitly give up on, with null) the in-game item path
//              for a sheet row that the automatic matcher gets wrong or misses.
// EXTRA_EVENT_ITEMS: items GameInfo.xml doesn't attach to an event, keyed by the
//              event's internal name (see js/data.js "events").
// WEAPON_ALIASES: sheet spellings of weapon names used in "Comes equipped in the X".

export const MANUAL_KEYS = {
  'Weapon|Magnum Revolver': '/Items/Weapons/Basic/HandGuns/Revolver/Weapon_Revolver',
  'Weapon|Sawed-Off': '/Items/Weapons/Basic/SawedOffShotgun/Weapon_SawedOffShotgun',
  'Weapon|Sporebloom': '/Items/Weapons/Boss/Root_SporeLauncher/Weapon_Root_SporeLauncher',
  'Weapon|Scrap Hatchet': '/Items/Weapons/Human/Melee/Hatchet/Weapon_Hatchet',
  'Weapon|Scrap Sword': '/Items/Weapons/Human/Melee/Sword/Weapon_Sword',
  'Weapon|Scrap Hammer': '/Items/Weapons/Human/Melee/Hammer/Weapon_Hammer',
  // Seen in a real save; Ace hands it out in Ward 13.
  'Weapon|Repeater Pistol': '/Items/Weapons/Basic/HandGuns/RepeaterPistol/Weapon_RepeaterPistol',
  'Mod|Breath of the Desert': '/Items/Mods/BreathOfDesert',
  // The mask is a quest item dropped by the Mad Merchant, not the craftable hood.
  'Armor|Twisted Mask': '/Items/QuestItems/TwistedMask/Quest_TwistedMask',
  'Amulet|Pocket Watch': '/Quests/Quest_OverworldPOI_MudTooth/Quest_BrabusPocketWatch',
  // Removed when leaving the tutorial, so it can never be "owned".
  'Weapon|Blade of Adventure': null,
  // Seen in a real profile; the sheet's names don't match them automatically.
  'Mod|Hot Shot': '/Items/Mods/HotShot',
  "Mod|Hunter's Mark": '/Items/Mods/HuntersMark',
  "Mod|Mender's Aura": '/Items/Mods/MendersAura',
  'Armor|Bomber Hat': '/Items/Armor/Bomber/Armor_Head_Bomber',
  'Armor|Adventurer Tunic': '/Items/Armor/Adventurer/Armor_Body_Adventurer',
  'Armor|Adventurer Leggings': '/Items/Armor/Adventurer/Armor_Legs_Adventurer',
};

// Ward 13: Ace hands out the Repeater Pistol, and the archetype mods are sold there too.
export const EXTRA_EVENT_ITEMS = {
  Ward13: [
    '/Items/Weapons/Basic/HandGuns/RepeaterPistol/Weapon_RepeaterPistol',
    '/Items/Mods/HotShot',
    '/Items/Mods/HuntersMark',
    '/Items/Mods/MendersAura',
  ],
};

export const WEAPON_ALIASES = {
  devestator: 'devastator',
};
