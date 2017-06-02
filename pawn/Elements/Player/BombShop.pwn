// Copyright 2006-2015 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the GPLv2 license, a copy of which can
// be found in the LICENSE file.

/*******************************************************************************
*   Las Venturas Playground 2.90 - Bomb Shop sync. Since the bomb shop has     *
*   never really been synched in SA:MP, it would be something nice to have for *
*   our players. Since LVP has a lot of gang stuff as-well, it will be nice    *
*   for gang members to create a roadblock with :) Different bomb types should *
*   be supported.                                                              *
*                                                                              *
*   Author: Jay                                                                *
*   wilkinson_929@hotmail.com                                                  *
*******************************************************************************/

forward bomb_Countdown(playerid);

#define BOMB_TYPE_PARKED 0
#define BOMB_TYPE_COUNTDOWN 2
#define BOMB_TYPE_DETONATOR 3

#define EXPLODE_TYPE_SMALL 0
#define EXPLODE_TYPE_MEDIUM 1
#define EXPLODE_TYPE_LARGE 2
#define EXPLODE_TYPE_MASSIVE 3

#define MIN_SPRAY_TAGS          30

// Bomb shop locations, one in LS one in L.V, Credits to Simon for the co-ords.
new Float:g_BombShops[2][6] =
{
    {2003.4459, 2307.2195,10.0,2008.4232,2315.4070,13.75 }, // L.V
    {1846.6150, -1857.9579,13.0,1855.5764,-1854.6993,16.75 } // L.S
};

new g_PlayerInBombShop[MAX_PLAYERS][2];
new Menu:BombMenu[2];
new IsPlayerInBombShop[MAX_PLAYERS];
new DetonateVehicle[MAX_PLAYERS];
new bombDetonation[MAX_PLAYERS];
new Text:g_BombCount[10] = {Text:INVALID_TEXT_DRAW, ...};
new g_BombTimer[MAX_PLAYERS];
new g_TextShow[MAX_PLAYERS];

enum vBomb
{
    VehicleArmed,
    BombType,
    ExplosionType,
    armer,
    bombcount
}

new VehicleBomb[MAX_VEHICLES][vBomb];

bool: LegacyIsVehicleBombAdded(vehicleId) {
    return !!VehicleBomb[vehicleId][VehicleArmed];
}

bool: LegacyIsPlayerInBombShop(playerId) {
    return !!IsPlayerInBombShop[playerId];
}

// CBomb__CheckPlayer. Checks if a player is in a bomb shop, and if so
// sets them to an interior and shows a bombshop menu.


CBomb__CheckPlayer(i)
{
    if(!Player(i)->isConnected() || !IsPlayerInAnyVehicle(i))
    {
        return 0;
    }

    for(new j; j<sizeof(g_BombShops); j++)
    {
        new
            Float:x,
            Float:y,
            Float:z;

        GetVehiclePos(GetPlayerVehicleID(i),x,y,z);

        if(IsPointInArea(x,y,z,g_BombShops[j][0],g_BombShops[j][3],g_BombShops[j][1],g_BombShops[j][4],g_BombShops[j][2],g_BombShops[j][5])

                && !g_PlayerInBombShop[i][j]

                && !IsPlayerInMinigame(i)

                && !IsPlayerInBombShop[i]

                && IsVehicleBombShopValid(GetPlayerVehicleID(i))

                && GetPlayerState(i) == PLAYER_STATE_DRIVER) {

                IsPlayerInBombShop[i] = true;
                g_PlayerInBombShop[i][j] = true;

            // Wait, we only allow players with experience to access the bombshop...
            #if BETA_TEST == 0
                if (sprayTagGetPlayerCount(i) < MIN_SPRAY_TAGS) {
                    ShowPlayerBox(i, "You need to have sprayed at least %d spray tags to unlock the bombshop.", MIN_SPRAY_TAGS);
                    RemovePlayerFromBombShop(i);
                    return 1;
                }
            #endif

            if (!IsPlayerInMainWorld(i)) {
                ShowBoxForPlayer(i, "Sorry, the BombShop is only available in the main world. Use /world 0!");
                RemovePlayerFromBombShop(i);
                return 1;
            }

            if (VehicleBomb[GetPlayerVehicleID(i)][VehicleArmed]) {
                ShowBoxForPlayer(i, "This vehicle is already armed.");
                RemovePlayerFromBombShop(i);
                return 1;
            }

            TogglePlayerControllable(i, false);
            SetPlayerVirtualWorld(i, GetIsolatedWorldForPlayer(i));
            SetVehicleVirtualWorld(GetPlayerVehicleID(i), GetIsolatedWorldForPlayer(i));

            for (new playerid = 0; playerid <= PlayerManager->highestPlayerId(); playerid++)
            {
                if(!Player(playerid)->isConnected())
                continue;

                if(!IsPlayerInVehicle(playerid, GetPlayerVehicleID(i)))
                continue;

                SetPlayerVirtualWorld(playerid, GetIsolatedWorldForPlayer(i));
            }

            SetVehiclePos(GetPlayerVehicleID(i),-2156.3550,-261.0685,36.5156);

            SetVehicleZAngle(GetPlayerVehicleID(i),86.2361);

            IsPlayerInBombShop[i] = true;

            if(GetPlayerState(i) == PLAYER_STATE_DRIVER)
            {
                ShowMenuForPlayer(BombMenu[0], i);
            }

            g_PlayerMenu[i] = true;
            SetPlayerCameraPos(i, -2160.9600,-262.3309,36.5156);
            SetPlayerCameraLookAt(i, -2156.3550,-261.0685,36.5156);
            SetPlayerInterior(i, 0);

        }else{
            // Otherwise if they are not in the bombshop and the var is still
            // set as 1, we need to reset it.
            if(g_PlayerInBombShop[i][j] && !IsPlayerInBombShop[i])
            g_PlayerInBombShop[i][j] = false;
        }
    }
    return 1;
}

// CBomb__ProcessMenu
// This function gets caleld from OnPlayerSelectedMenuRow and manages all menus
// that are used in the bomb shop.

CBomb__ProcessMenu(playerid,row)
{
    new str[256];
    new propertyId = PropertyManager->propertyForSpecialFeature(BombshopFeature),
        endid = propertyId == Property::InvalidId ? Player::InvalidId : Property(propertyId)->ownerId();

    // Main menu.
    if(GetPlayerMenu(playerid) == BombMenu[0])
    {
        switch(row)
        {
            // Engine Bomb. An engine bomb explodes the vehicle as somebody
            // enters it, making it highly effective. We have to make these
            // reasonably expensive so that we don't end up having pratically every
            // vehicle in L.V having one. Still, would be funny though :>
        case 0:
            {
                // is our player in a vehicle? (near impossible scenario)
                if(!IsPlayerInAnyVehicle(playerid))
                {
                    SendClientMessage(playerid,Color::Red,"* You're not in a vehicle!");
                    TogglePlayerControllable(playerid,true);
                    return 1;
                }

                new const bombPrice = GetEconomyValue(BombTypeEngine);

                // can our player afford an engine bomb?
                if(GetPlayerMoney(playerid) < bombPrice)
                {
                    format(str,256,"The engine bombs cost $%s!",formatPrice(bombPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[0],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }

                // otherwise, it's all good.
                PlayerPlaySound(playerid, 1133, 0.0, 0.0, 0.0);
                TakeRegulatedMoney(playerid, BombTypeEngine);
                ShowMenuForPlayer(BombMenu[1],playerid);
                g_PlayerMenu[ playerid ] = true;
                ShowBoxForPlayer(playerid, "Please choose the explosion impact");

                // Set the vehicle armed var to true, set the bomb type, and the armer id.
                VehicleBomb[GetPlayerVehicleID(playerid)][VehicleArmed] = true;
                VehicleBomb[GetPlayerVehicleID(playerid)][BombType] = BOMB_TYPE_PARKED;
                VehicleBomb[GetPlayerVehicleID(playerid)][armer] = playerid;
                if(Player(endid)->isConnected() && endid != playerid)
                {
                    new const ownerShare = GetEconomyValue(BombTypeEngineOwnersShare);

                    format(str,256,"* %s (Id:%d) bought an {A9C4E4}engine bomb{CCCCCC}, you earned {A9C4E4}$%s{CCCCCC}.",
                        PlayerName(playerid), playerid, formatPrice(ownerShare));
                    SendClientMessage(endid,Color::ConnectionMessage,str);
                    GiveRegulatedMoney(playerid, BombTypeEngineOwnersShare);
                }

                Instrumentation->recordActivity(VehicleArmedWithBombActivity, 1); // [1] = engine bomb
                return 1;
            }

            // Detonation bomb. This bomb is triggered by using the
            // detonator weapon. It will work with GetPlayerWeapon
            // and OnPlayerKeyStateChange. It will be a nice way too
            // trick our freinds :>
        case 1:
            {

                if(!IsPlayerInAnyVehicle(playerid))
                {
                    SendClientMessage(playerid,Color::Red,"* You're not in a vehicle!");
                    TogglePlayerControllable(playerid,true);
                    return 1;
                }

                new const bombPrice = GetEconomyValue(BombTypeDetonator);

                if(GetPlayerMoney(playerid) < bombPrice)
                {
                    format(str,256,"The detonation bombs cost $%s.",formatPrice(bombPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[0],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }

                PlayerPlaySound(playerid, 1133, 0.0, 0.0, 0.0);
                TakeRegulatedMoney(playerid, BombTypeDetonator);
                ShowMenuForPlayer(BombMenu[1],playerid);
                g_PlayerMenu[ playerid ] = true;
                ShowBoxForPlayer(playerid, "Choose the explosion impact");
                VehicleBomb[GetPlayerVehicleID(playerid)][VehicleArmed] = true;
                VehicleBomb[GetPlayerVehicleID(playerid)][BombType] = BOMB_TYPE_DETONATOR;
                VehicleBomb[GetPlayerVehicleID(playerid)][armer] = playerid;
                DetonateVehicle[playerid] = GetPlayerVehicleID(playerid);

                if(Player(endid)->isConnected() && endid != playerid)
                {
                    new const ownerShare = GetEconomyValue(BombTypeDetonatorOwnersShare);

                    format(str,256,"* %s (Id:%d) bought a {A9C4E4}detonation bomb{CCCCCC}, you earned {A9C4E4}$%s{CCCCCC}.",
                        PlayerName(playerid), playerid, formatPrice(ownerShare));
                    SendClientMessage(endid,Color::ConnectionMessage,str);
                    GiveRegulatedMoney(endid, BombTypeDetonatorOwnersShare);
                }

                Instrumentation->recordActivity(VehicleArmedWithBombActivity, 2); // [2] = detonation bomb
                return 1;

            }
            // Countdown bomb. When triggered, this bomb will show a 10 second countdown
            // before it explodes to the person who armed it. Not as good as the other two,
            // still fun to use though.
        case 2:
            {

                if(!IsPlayerInAnyVehicle(playerid))
                {
                    SendClientMessage(playerid,Color::Red,"* You're not in a vehicle!");
                    TogglePlayerControllable(playerid,true);
                    return 1;
                }

                new const bombPrice = GetEconomyValue(BombTypeCountdown);

                if(GetPlayerMoney(playerid) < bombPrice)
                {
                    format(str,256,"The countdown bombs cost $%s.",formatPrice(bombPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[0],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }

                PlayerPlaySound(playerid, 1133, 0.0, 0.0, 0.0);
                TakeRegulatedMoney(playerid, BombTypeCountdown);
                ShowMenuForPlayer(BombMenu[1],playerid);
                g_PlayerMenu[ playerid ] = true;
                ShowBoxForPlayer(playerid, "Please choose the explosion impact");
                VehicleBomb[GetPlayerVehicleID(playerid)][VehicleArmed] = true;
                VehicleBomb[GetPlayerVehicleID(playerid)][BombType] = BOMB_TYPE_COUNTDOWN;
                VehicleBomb[GetPlayerVehicleID(playerid)][armer] = playerid;
                DetonateVehicle[playerid] = GetPlayerVehicleID(playerid);
                bombDetonation[playerid] = 10;

                if(Player(endid)->isConnected() && endid != playerid)
                {
                    new const ownerShare = GetEconomyValue(BombTypeCountdownOwnersShare);

                    format(str,256,"* %s (Id:%d) bought a {A9C4E4}countdown bomb{CCCCCC}, you earned {A9C4E4}$%s{CCCCCC}.",
                        PlayerName(playerid), playerid, formatPrice(ownerShare));
                    SendClientMessage(endid,Color::ConnectionMessage,str);
                    GiveRegulatedMoney(endid, BombTypeDetonatorOwnersShare);
                }

                Instrumentation->recordActivity(VehicleArmedWithBombActivity, 3); // [3] = countdown bomb
                return 1;
            }
        }
    }

    // Sub menu - Explosion types
    if(GetPlayerMenu(playerid) == BombMenu[1])
    {
        // Is the players vehicle armed?
        if(!VehicleBomb[GetPlayerVehicleID(playerid)][VehicleArmed])
        {
            SendClientMessage(playerid,Color::Red,"* Your vehicle isn't armed!");
            RemovePlayerFromBombShop(playerid);
            return 1;
        }

        // Is the player the person who armed it?
        if(VehicleBomb[GetPlayerVehicleID(playerid)][armer] != playerid)
        {
            SendClientMessage(playerid,Color::Red,"* You didn't arm the vehicle!");
            RemovePlayerFromBombShop(playerid);
            return 1;
        }

        new EconomyValueType: explosionType;

        // Now, we have to check if a player has the correct amount of money.
        switch(row)
        {
            // Medium explosion. Does some damage, but not lethal.
        case 1:
            {
                explosionType = BombExplosionMedium;

                new const explosionPrice = GetEconomyValue(explosionType);
                if(GetPlayerMoney(playerid) < explosionPrice)
                {
                    format(str,256,"You need $%s for a medium explosion.", formatPrice(explosionPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[1],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }
            }
            // Large explosion. Kills.
        case 2:
            {
                explosionType = BombExplosionLarge;

                new const explosionPrice = GetEconomyValue(explosionType);
                if(GetPlayerMoney(playerid) < explosionPrice)
                {
                    format(str,256,"You need $%s for a large explosion.",formatPrice(explosionPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[1],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }
            }

            // Massive explosion. Kills anybody around it as-well. LETHAL.
        case 3:
            {
                explosionType = BombExplosionExtreme;

                new const explosionPrice = GetEconomyValue(explosionType);
                if(GetPlayerMoney(playerid) < explosionPrice)
                {
                    format(str,256,"You need $%s for a huge explosion!",formatPrice(explosionPrice));
                    ShowBoxForPlayer(playerid, str);
                    ShowMenuForPlayer(BombMenu[1],playerid);
                    g_PlayerMenu[ playerid ] = true;
                    return 1;
                }
            }// eof case
        }// eof switch

        // Otherwise, it is all good. We set the vehicle bomb type in accordance
        // to the row selected making it nice and easy :)
        VehicleBomb[GetPlayerVehicleID(playerid)][ExplosionType] = row;
        RemovePlayerFromBombShop(playerid);
        SendClientMessage(playerid,Color::Green,"* Vehicle Bomb setup.");
        ShowBoxForPlayer(playerid, "Vehicle Armed!");
        TakeRegulatedMoney(playerid, explosionType);
    }
    return 1;
}

// CBomb__VehicleDeath
// This gets called from OnVehicleDeath, and resets the vehicle bomb
// if it is armed.
CBomb__VehicleDeath(vehicleid)
{
    DisarmVehicle(vehicleid, 0);
    return 1;
}

// CBomb__Initialize
// Gets called from OnGameModeInit. Simply sets up the menus used in the
// bomb shop.
CBomb__Initialize()
{
    BombMenu[0] = CreateMenu("~g~Bomb Shop", 2, 200.0, 200.0, 150.0, 150.0);

    new priceString[128];

    AddMenuItem( BombMenu[0],   0,   "Engine Bomb");
    AddMenuItem( BombMenu[0],   0,   "Detonation Bomb");
    AddMenuItem( BombMenu[0],   0,   "Countdown bomb");

    format(priceString, sizeof(priceString), "$%s", formatPrice(GetEconomyValue(BombTypeEngine)));
    AddMenuItem( BombMenu[0],   1,   priceString);

    format(priceString, sizeof(priceString), "$%s", formatPrice(GetEconomyValue(BombTypeDetonator)));
    AddMenuItem( BombMenu[0],   1,   priceString);

    format(priceString, sizeof(priceString), "$%s", formatPrice(GetEconomyValue(BombTypeCountdown)));
    AddMenuItem( BombMenu[0],   1,   priceString);


    BombMenu[1] = CreateMenu("~r~Explosion Type", 2, 200.0, 200.0, 150.0, 150.0);

    AddMenuItem( BombMenu[1],   0,   "Small Explosion");
    AddMenuItem( BombMenu[1],   0,   "Medium Explosion");
    AddMenuItem( BombMenu[1],   0,   "Large Explosion");
    AddMenuItem( BombMenu[1],   0,   "Enormous Explosion");

    AddMenuItem( BombMenu[1],   1,   "~g~Free");

    format(priceString, sizeof(priceString), "~p~+ $%s", formatPrice(GetEconomyValue(BombExplosionMedium)));
    AddMenuItem( BombMenu[1],   1,   priceString);

    format(priceString, sizeof(priceString), "~y~+ $%s", formatPrice(GetEconomyValue(BombExplosionLarge)));
    AddMenuItem( BombMenu[1],   1,   priceString);

    format(priceString, sizeof(priceString), "~r~+ $%s", formatPrice(GetEconomyValue(BombExplosionExtreme)));
    AddMenuItem( BombMenu[1],   1,   priceString);

    return 1;
}

// CBomb__EngineCheck. This functionc hecks if when a player enters a vehicle,
// it is armed with an engine bomb, if so, the second they start the engine, boom.
// the i is ran of a loop so we can check if anyone else is in the car too and
// kill them :)
CBomb__EngineCheck(playerid,vehicleid,i)
{
    // Is the vehicle valid, armed, has the armed player connected, and is
    // a engine bomb?

    if(VehicleBomb[vehicleid][VehicleArmed] && Player(VehicleBomb[vehicleid][armer])->isConnected() &&  VehicleBomb[vehicleid][BombType] == BOMB_TYPE_PARKED)
    {
        new Float:x, Float:y, Float:z;
        GetVehiclePos(vehicleid ,x ,y , z);
        if (x >= 1950.5 && x <= 2070.47 && y >= 1480.0 && y <= 1620.70)
        {
            return SendClientMessage(VehicleBomb[vehicleid][armer],Color::Red, "Your bomb didn't go off because the vehicle is too close to the ship!");
        }
        else if (x >= 2051.78 && x <= 2115.57 && y >= 2146.78 && y <= 2202.01)
        {
            return SendClientMessage(VehicleBomb[vehicleid][armer],Color::Red, "Your bomb didn't go off because the vehicle is too close to Fight Club!");
        }
        else
        {
            DisarmVehicle(vehicleid,1,i); // explode the vehicle ;)
            new str[256];
            format(str,256,"Your vehicle engine bomb exploded on %s.",PlayerName(playerid));
            SetPlayerHealthIfGodmodeDisabled(playerid, 0);

            if (playerid != VehicleBomb[vehicleid][armer]) {
                validKillerId[playerid] = VehicleBomb[vehicleid][armer];
                validReasonId[playerid] = WEAPON_EXPLOSION;
            }

            ShowBoxForPlayer(VehicleBomb[vehicleid][armer], str);
            CAchieve__DetonateBomb(playerid);
            return 1;
        }
    }
    return 1;
}

// CBomb__DetonateCheck. Called from OnPlayerKeyStateChange, this checks if a player
// presses the detonator to explode the vehicle or start the countdown :)

CBomb__DetonateCheck(playerid,newkeys)
{
    if((newkeys & KEY_LOOK_BEHIND) == KEY_LOOK_BEHIND || ((newkeys & 320) == 320))
    {
        if(!IsPlayerInBombShop[playerid])
        {
            for(new vid = 0; vid < MAX_VEHICLES; vid++)
            {
                if(!VehicleBomb[vid][VehicleArmed])
                {
                    continue;
                }

                if(VehicleBomb[vid][armer] != playerid)
                {
                    continue;
                }

                if(VehicleBomb[vid][BombType] == BOMB_TYPE_COUNTDOWN)
                {
                    CBomb__CheckCountdownDetonation(playerid, DetonateVehicle[playerid]);
                }

                // Check for the detonation bomb.
                if(VehicleBomb[vid][BombType] == BOMB_TYPE_DETONATOR)
                {
                    new
                        Float:fPosX,
                        Float:fPosY,
                        Float:fPosZ;

                    GetVehiclePos(vid, fPosX, fPosY, fPosZ);

                    if (fPosX >= 1950.5 && fPosX <= 2070.47 && fPosY >= 1480.0 && fPosY <= 1620.70)
                    {
                        ShowBoxForPlayer(playerid, "Your vehicle is too close to the ship and therefore did not detonate.");
                        continue;
                    }
                    if (fPosX >= 2051.78 && fPosX <= 2115.57 && fPosY >= 2146.78 && fPosY <= 2202.01)
                    {
                        ShowBoxForPlayer(playerid, "Your vehicle is too close to Fight Club and therefore did not detonate.");
                        continue;
                    }

                    if (GetVehicleVirtualWorld(vid) != GetPlayerVirtualWorld(playerid)) {
                        ShowBoxForPlayer(playerid, "Your vehicle is in another world and therefore did not detonate.");
                        continue;
                    }

                    GameTextForPlayer(playerid,"~w~~n~~n~~n~Vehicle Detonated!",5000,5);

                    DisarmVehicle(vid);
                }
            }
        }
    }
    return 1;
}

// CBomb__CheckCountdownDetonation
// checks for the countdown detonation bomb
CBomb__CheckCountdownDetonation(playerid, vid)
{
    if(!Player(playerid)->isConnected())
        return;

    if(vid < 0 || vid >= MAX_VEHICLES)
        return;

    if(VehicleBomb[vid][BombType] != BOMB_TYPE_COUNTDOWN)
        return;

    if(bombDetonation[playerid] != 10)
        return;

    if(VehicleBomb[vid][armer] != playerid)
        return;

    new
        Float:x,
        Float:y,
        Float:z;

    GetVehiclePos(vid,x,y,z);
    if (x >= 1950.5 && x <= 2070.47 && y >= 1480.0 && y <= 1620.70)
    {
        ShowBoxForPlayer(playerid, "Your vehicle is too close to the ship and therefore did not detonate.");
        return;
    }
    if (x >= 2051.78 && x <= 2115.57 && y >= 2146.78 && y <= 2202.01)
    {
        ShowBoxForPlayer(playerid, "Your vehicle is too close to Fight Club and therefore did not detonate.");
        return;
    }

    bombDetonation[playerid] = 10;
    g_BombTimer[playerid] = true;
    g_TextShow[playerid] = 1;
}


// CBomb__CreateTextdraws
// Called from OnGameModeInit, creates the textdraws.

CBomb__CreateTextdraws()
{
    new szCount[30];

    for(new i; i <9; i++)
    {
        format(szCount, 30, "Detonation: 00:0%d", i);
        g_BombCount[i] = TextDrawCreate(497, 103, szCount);
        TextDrawAlignment(g_BombCount[i],0);
        TextDrawBackgroundColor(g_BombCount[i],0xffffffff);
        TextDrawFont(g_BombCount[i],1);
        TextDrawLetterSize(g_BombCount[i],0.399999,1.300000);
        TextDrawColor(g_BombCount[i],0x000000ff);
        TextDrawSetOutline(g_BombCount[i],1);
        TextDrawSetProportional(g_BombCount[i],1);
    }
}

// CBomb__Countdown This is called from a timer which decreases the seconds when a
// player has activated a countdown bomb. It is currently used with SetTimeEx,
// however in future it should be called from LVP's main timers, aswell as another
// function in here that manages explosions.
CBomb__Countdown(playerid)
{
    // is the bomb timer active for the player?
    if(!g_BombTimer[playerid])
        return 0;

    // Decrease the seconds that have passed.

    if(bombDetonation[playerid] < 10)
    TextDrawHideForPlayer(playerid, g_BombCount[bombDetonation[playerid]]);

    bombDetonation[playerid]--;

    // if the seconds are on 0, we destroy the textdraw, kill the timer,
    // and detonate the vehicle.
    if(bombDetonation[playerid] == 0)
    {
        g_TextShow[playerid] = false;


        // But first, check if the bomb is on the ship
        new
            Float:fPosX,
            Float:fPosY,
            Float:fPosZ;

        GetVehiclePos(DetonateVehicle[playerid], fPosX, fPosY, fPosZ );

        if(fPosX >= 2007.00 && fPosX <= 2025.47 && fPosY >= 1538.00 && fPosY <= 1551.00 ||    // ramp area
                fPosX >= 1994.00 && fPosX <= 2007.00 && fPosY >= 1515.00 && fPosY <= 1575.00)
        {
            if(fPosZ < 40)
            {
                DisarmVehicle(DetonateVehicle[playerid], false);
                ShowBoxForPlayer(playerid, "The bomb failed to explode.");
            }
        }else{
            DisarmVehicle(DetonateVehicle[playerid]);
        }

        return 1;
    }

    TextDrawShowForPlayer(playerid, g_BombCount[bombDetonation[playerid]]);
    return 1;
}

// RemovePlayerFromBombShop. This function basically
// sets the player out of the bomb shop and in the relevant
// position to where they was last.
RemovePlayerFromBombShop(playerid)
{
    if(!Player(playerid)->isConnected()) return 0;

    if(!IsPlayerInBombShop[playerid]) return 0;


    TogglePlayerControllable(playerid,true);
    IsPlayerInBombShop[playerid] = false;
    SetCameraBehindPlayer(playerid);
    HideMenuForPlayer(BombMenu[0],playerid);
    HideMenuForPlayer(BombMenu[1],playerid);
    g_PlayerMenu[playerid] = false;

    SetPlayerVirtualWorld(playerid, g_VirtualWorld[playerid]);
    SetVehicleVirtualWorld(GetPlayerVehicleID(playerid), g_VirtualWorld[playerid]);

    for (new i = 0; i <= PlayerManager->highestPlayerId(); i++)
    {
        if(!Player(i)->isConnected())
        continue;

        if(i == playerid)
        continue;

        if(!IsPlayerInVehicle(i, GetPlayerVehicleID(playerid)))
        continue;

        SetPlayerVirtualWorld(i, g_VirtualWorld[playerid]);
    }

    // L.V Bomb shop
    if(g_PlayerInBombShop[playerid][0])
    {
        g_PlayerInBombShop[playerid][0] = false;
        SetVehiclePos(GetPlayerVehicleID(playerid),2008.2332,2284.8938,10.4103);
        SetVehicleZAngle(GetPlayerVehicleID(playerid),90.6559);

        // L.S bomb shop
    }else if (g_PlayerInBombShop[playerid][1])
    {
        SetVehiclePos(GetPlayerVehicleID(playerid),1833.1917,-1858.9941,13.5781);
        SetVehicleZAngle(GetPlayerVehicleID(playerid),189.9434);

        g_PlayerInBombShop[playerid][1] = false;

    }

    return 1;
}

// ResetVehicleData
// This function simply reset's the vehicle bomb data
// without it exploding
CBomb__ResetVehicleData(vehicleid)
{
    VehicleBomb[vehicleid][VehicleArmed] = 0;

    new endid = VehicleBomb[vehicleid][armer];

    DetonateVehicle[endid] = -1;
    bombDetonation[endid] = 10;

    g_BombTimer[endid]= false;
    g_TextShow[endid] = false;

    for(new ij; ij < 9; ij++)
    TextDrawHideForPlayer(endid, g_BombCount[ij]);

}

CBomb__CreateExplosion(vehicleId) {
    new const virtualWorld = GetVehicleVirtualWorld(vehicleId);
    new Float: vehicleHealth;

    GetVehicleHealth(vehicleId, vehicleHealth);

    switch (VehicleBomb[vehicleId][ExplosionType]) {
        case EXPLODE_TYPE_SMALL:
            SetVehicleHealth(vehicleId, vehicleHealth - 350);
        case EXPLODE_TYPE_MEDIUM:
            SetVehicleHealth(vehicleId, vehicleHealth - 500);
        case EXPLODE_TYPE_LARGE:
            SetVehicleHealth(vehicleId, 0);
        case EXPLODE_TYPE_MASSIVE:
            SetVehicleHealth(vehicleId, 0);
    }

    new Float: x, Float: y, Float: z;
    GetVehiclePos(vehicleId, x, y, z);

    for (new playerId = 0; playerId <= PlayerManager->highestPlayerId(); ++playerId) {
        if (!Player(playerId)->isConnected() || IsPlayerNPC(playerId))
            continue;  // the |playerId| is either not connected, or is an NPC

        if (GetPlayerVirtualWorld(playerId) != virtualWorld)
            continue;  // the |playerId| is in a different Virtual World

        if (!IsPlayerInRangeOfPoint(playerId, 300.0, x, y, z))
            continue;  // the |playerId| is too far away to see the explosion

        switch (VehicleBomb[vehicleId][ExplosionType]) {
            case EXPLODE_TYPE_SMALL: {
                CreateExplosionForPlayer(playerId, x, y, z, 11, 2);
            }
            case EXPLODE_TYPE_MEDIUM: {
                CreateExplosionForPlayer(playerId, x, y, z, 2, 3);
                CreateExplosionForPlayer(playerId, x, y, z, 8, 6);
            }
            case EXPLODE_TYPE_LARGE: {
                CreateExplosionForPlayer(playerId, x, y, z, 10, 6);
                CreateExplosionForPlayer(playerId, x, y, z, 8, 6);
                CreateExplosionForPlayer(playerId, x, y, z, 10, 10);
                CreateExplosionForPlayer(playerId, x, y, z, 6, 15);
            }
            case EXPLODE_TYPE_MASSIVE: {
                CreateExplosionForPlayer(playerId, x, y, z, 10, 6);
                CreateExplosionForPlayer(playerId, x, y, z, 10, 10);
                CreateExplosionForPlayer(playerId, x, y, z, 8, 3);
                CreateExplosionForPlayer(playerId, x, y, z, 2, 3);
                CreateExplosionForPlayer(playerId, x, y, z, 2, 350);
                CreateExplosionForPlayer(playerId, x, y, z, 6, 350);
            }
        }
    }
}

// DisarmVehicle. This manages the vehicle bombs, and whether
// or not the vehicle needs to explode. It also has support to be called
// from a loop or not. If it doesn't get called from a loop, it does it's own.
DisarmVehicle(vehicleid, explode=1, i=-1, check=0)
{
    if(!GetVehicleModel(vehicleid))
        return 0;

    // is it rigged?
    if(!VehicleBomb[vehicleid][VehicleArmed])
        return 0;
        
    if (check == 1 && VehicleBomb[vehicleid][VehicleArmed])
        return 1;

    // if our player has disconnected, it doesn't explode.
    if(!Player(VehicleBomb[vehicleid][armer])->isConnected())
        explode = 0;

    // Now,we get the co-ords of the vehicle to create the explosion.
    new Float:x,
        Float:y,
        Float:z,
        Float:vhp,
        Float:php;

    GetVehiclePos(vehicleid,x,y,z);
    GetVehicleHealth(vehicleid,vhp);
    GetPlayerHealth(i,php);

    // make sure we disarm the vehicle so it can't be exploded over & over again.
    VehicleBomb[vehicleid][VehicleArmed] = false;

    // we need to get the id of the player who arms it to set some vars.
    new endid = VehicleBomb[vehicleid][armer];

    if(IsPlayerInBombShop[endid])
        return 0;

    DetonateVehicle[endid] = -1;
    bombDetonation[endid] = 10;
    g_BombTimer[endid]= false;

    for(new ij; ij < 9; ij++)
        TextDrawHideForPlayer(endid, g_BombCount[ij]);

    g_TextShow[endid] = false;

    new message[128];
    if (explode) {
        Instrumentation->recordActivity(VehicleDetonateBombActivity);
        MyCarBombs[endid]++;
        format(message, sizeof(message), "%s (Id:%d) just exploded a carbomb.", Player(endid)->nicknameString(), endid);
        Admin(endid, message);
    }

    // If the function didn't get called from a loop, we need to make
    // our own loop so calculate whether the vehicle has any passengers,
    // since by default, SA:MP does fuck all for passengers.
    if(i == -1)
    {
        for (i = 0; i <= PlayerManager->highestPlayerId(); i++)
        {
            if(!Player(i)->isConnected())
            {
                continue;
            }

            if(IsPlayerInVehicle(i, vehicleid))
            {
                new Float:hp;
                GetPlayerHealth(i,hp);

                switch(VehicleBomb[vehicleid][ExplosionType])
                {
                    case EXPLODE_TYPE_SMALL: {
                        SetPlayerHealthIfGodmodeDisabled(i, hp-40);
                        if (i != VehicleBomb[vehicleid][armer]) {
                            validKillerId[i] = VehicleBomb[vehicleid][armer];
                            validReasonId[i] = WEAPON_EXPLOSION;
                        }
                    }
                    case EXPLODE_TYPE_MEDIUM: {
                        SetPlayerHealthIfGodmodeDisabled(i, hp-80);
                        if (i != VehicleBomb[vehicleid][armer]) {
                            validKillerId[i] = VehicleBomb[vehicleid][armer];
                            validReasonId[i] = WEAPON_EXPLOSION;
                        }
                    }
                    case EXPLODE_TYPE_LARGE: {
                        SetPlayerHealthIfGodmodeDisabled(i, 0);
                        if (i != VehicleBomb[vehicleid][armer]) {
                            validKillerId[i] = VehicleBomb[vehicleid][armer];
                            validReasonId[i] = WEAPON_EXPLOSION;
                        }
                    }
                    case EXPLODE_TYPE_MASSIVE: {
                        SetPlayerHealthIfGodmodeDisabled(i, 0);
                        if (i != VehicleBomb[vehicleid][armer]) {
                            validKillerId[i] = VehicleBomb[vehicleid][armer];
                            validReasonId[i] = WEAPON_EXPLOSION;
                        }
                    }
                }
            }
        }

        // is the explode is set to 1, we blow up the vehicle :>
        if(explode)
        {
            CBomb__CreateExplosion(vehicleid);
        }
    }else{
        // otherwise, a loop has been assigned to the function, we can continue
        // by using the value of the loop. Not the best of methods, I know. but hey,
        // it works!
        if(explode)
        {
            if(IsPlayerInVehicle(i,vehicleid))
            {
                new Float:hp;
                GetPlayerHealth(i,hp);

                switch(VehicleBomb[vehicleid][ExplosionType])
                {
                case EXPLODE_TYPE_SMALL: {
                    SetPlayerHealthIfGodmodeDisabled(i, hp-40);
                    if (i != VehicleBomb[vehicleid][armer]) {
                        validKillerId[i] = VehicleBomb[vehicleid][armer];
                        validReasonId[i] = WEAPON_EXPLOSION;
                    }
                }
                case EXPLODE_TYPE_MEDIUM: {
                    SetPlayerHealthIfGodmodeDisabled(i, hp-80);
                    if (i != VehicleBomb[vehicleid][armer]) {
                        validKillerId[i] = VehicleBomb[vehicleid][armer];
                        validReasonId[i] = WEAPON_EXPLOSION;
                    }
                }
                case EXPLODE_TYPE_LARGE: {
                    SetPlayerHealthIfGodmodeDisabled(i, 0);
                    if (i != VehicleBomb[vehicleid][armer]) {
                        validKillerId[i] = VehicleBomb[vehicleid][armer];
                        validReasonId[i] = WEAPON_EXPLOSION;
                    }
                }
                case EXPLODE_TYPE_MASSIVE: {
                    SetPlayerHealthIfGodmodeDisabled(i, 0);
                    if (i != VehicleBomb[vehicleid][armer]) {
                            validKillerId[i] = VehicleBomb[vehicleid][armer];
                            validReasonId[i] = WEAPON_EXPLOSION;
                        }
                }
                }
            }

            CBomb__CreateExplosion(vehicleid);
        }
    }

    return 1;
}



IsPointInArea( Float:fX, Float:fY, Float:fZ, Float:fMinX, Float:fMaxX, Float:fMinY, Float:fMaxY, Float:fMinZ=-99999.0, Float:fMaxZ=99999.9 )
{
    // Checks if a point is inside the area specified. Credits to Simon.

    if ( fX > fMinX && fX < fMaxX && fY > fMinY && fY < fMaxY && fZ > fMinZ && fZ < fMaxZ )
    return 1;

    else
    return 0;
}

// IsVehicleBombShopValid. This function returns true if a vehicle can work in a
// bombshop and 0 if it doesn't. If a vehicle doesn't work in a bombshop, we let
// GTASA deal with it, which by default explains that it "doesn't touch nothing
// that hot".
IsVehicleBombShopValid(vehicleid)
{
    new mod = GetVehicleModel(vehicleid);
    // is our vehicle model valid?
    if(mod < 400 || mod > 620) return 0;
    // is our vehicle valid?
    if(!GetVehicleModel(vehicleid)) return 0;
    switch(mod)
    {
        case
        581, 509, 481, 462, 521, 463, 510,
        522, 461, 448, 471, 468, 586, 472,
        473, 493, 595, 484, 430, 453, 452,
        446, 454, 592, 577, 511, 512, 593,
        520, 553, 476, 519, 460, 513, 441,
        464, 465, 501, 564, 594:
        return 0;
    }
    return 1;
}

// Helper function which changes the health of a player in case godmode is DISABLED
SetPlayerHealthIfGodmodeDisabled(playerId, Float:healthAmount) {
    if (!g_bPlayerGodmode[playerId])
        SetPlayerHealth(playerId, healthAmount);
}
