// Copyright 2006-2015 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the GPLv2 license, a copy of which can
// be found in the LICENSE file.

/*******************************************************************************
*   Las Venturas Playground v2.90 - Regular.pwn. This command file contains    *
*   all of the commands in LVP that are available to the regular players.      *
*******************************************************************************/

// Command: /ignore
// Parameters: [playerid]
// Creator: Peter
lvp_Ignore( playerid, params[] )
{
    Instrumentation->recordActivity(IgnorePlayerActivity);

    if(!strlen(params))
    {
        SendClientMessage( playerid, Color::White, "Use: /ignore [playerid/name]");
        return 1;
    }

    new ignoreID = SelectPlayer(params );
    // Proper parameters given to the command?
    if (ignoreID == Player::InvalidId)
    {
        SendClientMessage( playerid, Color::White, "Usage: /ignore [playerid/name]" );
        return 1;
    }

    // Do we want to ignore ourselfes (silly people ~.~)
    if (ignoreID == playerid)
    {
        SendClientMessage( playerid, Color::Red, "You cannot ignore yourself, silly!" );
        return 1;
    }

    // Now just toggle our magical and powerfull switch.
    g_Ignore[ playerid ][ ignoreID ] = true;

    new szName[ 24 ], szMessage[ 256 ];
    GetPlayerName( ignoreID, szName, 24 );
    format( szMessage, sizeof( szMessage ), "You have successfully ignored %s (Id:%d)!", szName, ignoreID);

    SendClientMessage( playerid, Color::Green, szMessage );
    return 1;
}

// Command: /unignore
// Parameters: [playerid]
// Creator: Peter
lvp_Unignore( playerid, params[] )
{
    if(!strlen(params))
    {
        SendClientMessage( playerid, Color::White, "Use: /unignore [playerid/name]");
        return 1;
    }

    new ignoreID = SelectPlayer(params );
    // Proper parameters given to the command?
    if (ignoreID == Player::InvalidId)
    {
        SendClientMessage( playerid, Color::White, "Usage: /unignore [playerid]" );
        return 1;
    }

    // Check if the player actually is ignored, would be usefull.
    if (g_Ignore[ playerid ][ignoreID] == false)
    {
        SendClientMessage( playerid, Color::Red, "You currently haven't ignored this player!" );
        return 1;
    }

    // Aight, now just update the switch again. <3 switches
    g_Ignore[ playerid ][ignoreID] = false;

    new szName[ 24 ], szMessage[ 256 ];
    GetPlayerName(ignoreID, szName, 24 );
    format( szMessage, sizeof( szMessage ), "You now receive messages from %s (ID:%d) again!", szName,ignoreID);

    SendClientMessage( playerid, Color::Green, szMessage );
    return 1;
}

// Command: /ignored
// Parameters: [playerid=0]
// Creator: Peter
lvp_Ignored( playerid, params[] )
{
    // The Ignored command simply returns a list of people this player
    // currently has ignored. Administrators can pass on an extra argument.
    new iCount, iCheckForPlayer = playerid, szName[ 24 ], szMessage[ 256 ],iRequestID ;
    if (Player(playerid)->isAdministrator() && params[0]) {
        param_shift( tempVar );
        iRequestID = SelectPlayer(tempVar);
        if (Player(iRequestID)->isConnected()) {
            iCheckForPlayer = iRequestID;
        }
        else 
        {
            SendClientMessage(playerid, Color::Red, "* That play doesn't exist");
            return 1;
        }
    }

    // Aight, start off with getting the player's name and sending
    // the header of our ignore overview, including the name.
    GetPlayerName( iCheckForPlayer, szName, 24 );
    format( szMessage, sizeof( szMessage ), "Players ignored by '%s':", szName );
    SendClientMessage( playerid, COLOR_ORANGE, szMessage );
    format( szMessage, sizeof( szMessage ), " " );

    // Check it out yo man o/ o/ Loop for all players;
    for (new i = 0; i <= PlayerManager->highestPlayerId(); i++) {
        if (Player(i)->isConnected() && g_Ignore[ iCheckForPlayer ][ i ] == true) {
            GetPlayerName( i, szName, 24 ); iCount++;
            format( szMessage, sizeof( szMessage ), "%s%s ", szMessage, szName );
            if (strlen( szMessage ) > 60) {
                SendClientMessage( playerid, Color::White, szMessage );
                format( szMessage, sizeof( szMessage ), " " );
            }
        }
    }

    // Do we have a message yet-to-be-send?
    if (strlen( szMessage ) > 4)
    SendClientMessage( playerid, Color::White, szMessage );

    // Allright, did we ignore anyone?
    if (iCount == 0)
    {
        SendClientMessage( playerid, Color::White, "Noone is being ignored." );
        return 1;
    }

    // Done o/
    return 1;
}


// Command: /settings
// Parameters: [setting] [value]
// Creator: Peter
lvp_settings(playerId, params[])
{
    param_shift(paramOption);

    // Do we have any parameters passed on?
    if (!strlen(paramOption)) {
        SendClientMessage(playerId, Color::Information, "Usage: /settings [infomsg/newsmsg/showmsg] [on/off]");
        return 1;
    }

    // First check whether any /settings command has been registered by individual features, as this
    // takes precedence over anything defined in the if/else list that follows. Syntax for any
    // methods listening to this switch is: onSettingsFooCommand(playerId, params[]).
    new result = Annotation::ExpandSwitch<SettingsCommand>(paramOption, playerId, params);
    if (result != -1) // it can still either be 0 or 1, but something handled it.
        return result;

    // For /showmessages
    if (!strcmp(paramOption, "showmsg", true, 7))
    {
        // Get the way how we want to toggle;
        param_shift(optionToggle);

        new message[128];

        if (Command->parameterCount(optionToggle) == 0) {
            format(message, sizeof(message), "Showing showmessages to you currently is %s{FFFFFF}.",
                (!showMessagesEnabled[playerId] ?
                    "{DC143C}disabled" :
                    "{33AA33}enabled"));
            SendClientMessage(playerId, Color::Information, message);
            SendClientMessage(playerId, Color::Information, "Usage: /settings showmsg [on/off]" );
            return 1;
        }

        showMessagesEnabled[playerId] = Command->booleanParameter(optionToggle, 0);

        format(message, sizeof(message), "Showing showmessages to you is now %s{33AA33}.",
            (!showMessagesEnabled[playerId] ?
                "{DC143C}disabled" :
                "{33AA33}enabled"));
        SendClientMessage(playerId, Color::Success, message);

        return 1;
    }

    // For automated announcements (i.e. those by Gunther)
    if (!strcmp(paramOption, "infomsg", true, 7)) {
        param_shift(optionToggle);

        new message[128];

        if (Command->parameterCount(optionToggle) == 0) {
            format(message, sizeof(message), "Showing info announcements to you currently is %s{FFFFFF}.",
                (PlayerSettings(playerId)->areAutomatedAnnouncementsDisabled() ?
                    "{DC143C}disabled" :
                    "{33AA33}enabled"));

            SendClientMessage(playerId, Color::Information, message);
            SendClientMessage(playerId, Color::Information, "Usage: /settings infomsg [on/off]" );
            return 1;
        }

        new const bool: enabled = Command->booleanParameter(optionToggle, 0);
        PlayerSettings(playerId)->setAutomatedAnnouncementsDisabled(!enabled);

        format(message, sizeof(message), "Showing info announcements to you is now %s{33AA33}.",
            (PlayerSettings(playerId)->areAutomatedAnnouncementsDisabled() ?
                    "{DC143C}disabled" :
                    "{33AA33}enabled"));

        SendClientMessage(playerId, Color::Success, message);
        return 1;
    }

    return 1;
}
