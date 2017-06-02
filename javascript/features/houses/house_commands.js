// Copyright 2016 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the MIT license, a copy of which can
// be found in the LICENSE file.

const CommandBuilder = require('components/command_manager/command_builder.js');
const Dialog = require('components/dialogs/dialog.js');
const HouseSettings = require('features/houses/house_settings.js');
const IdentityBeam = require('features/houses/utils/identity_beam.js');
const InteriorList = require('features/houses/utils/interior_list.js');
const InteriorSelector = require('features/houses/utils/interior_selector.js');
const Menu = require('components/menu/menu.js');
const MessageBox = require('components/dialogs/message_box.js');
const ParkingLotCreator = require('features/houses/utils/parking_lot_creator.js');
const ParkingLotRemover = require('features/houses/utils/parking_lot_remover.js');
const PlayerMoneyBridge = require('features/houses/utils/player_money_bridge.js');

// Maximum number of milliseconds during which the identity beam should be displayed.
const IdentityBeamDisplayTimeMs = 60000;

// This class provides the `/house` command available to administrators to manage parts of the
// Houses feature on Las Venturas Playground. Most interaction occurs through dialogs.
class HouseCommands {
    constructor(manager, abuse, announce, economy, location, playground) {
        this.manager_ = manager;

        this.abuse_ = abuse;
        this.announce_ = announce;
        this.economy_ = economy;
        this.location_ = location;

        this.playground_ = playground;
        this.playground_.addReloadObserver(
            this, HouseCommands.prototype.registerTrackedCommands);

        this.registerTrackedCommands(playground());

        this.parkingLotCreator_ = new ParkingLotCreator();
        this.parkingLotRemover_ = new ParkingLotRemover();

        // Command: /house [buy/cancel/create/enter/goto/interior/modify/remove/save/settings]
        server.commandManager.buildCommand('house')
            .restrict(player => this.playground_().canAccessCommand(player, 'house'))
            .sub('buy')
                .build(HouseCommands.prototype.onHouseBuyCommand.bind(this))
            .sub('cancel')
                .build(HouseCommands.prototype.onHouseCancelCommand.bind(this))
            .sub('create')
                .restrict(Player.LEVEL_ADMINISTRATOR)
                .build(HouseCommands.prototype.onHouseCreateCommand.bind(this))
            .sub('enter')
                .restrict(Player.LEVEL_ADMINISTRATOR)
                .build(HouseCommands.prototype.onHouseEnterCommand.bind(this))
            .sub('goto')
                .parameters([{ name: 'filter', type: CommandBuilder.WORD_PARAMETER, optional: true }])
                .build(HouseCommands.prototype.onHouseGotoCommand.bind(this))
            .sub('interior')
                .restrict(Player.LEVEL_MANAGEMENT)
                .parameters([{ name: 'id', type: CommandBuilder.NUMBER_PARAMETER }])
                .build(HouseCommands.prototype.onHouseInteriorCommand.bind(this))
            .sub('modify')
                .restrict(Player.LEVEL_ADMINISTRATOR)
                .build(HouseCommands.prototype.onHouseModifyCommand.bind(this))
            .sub('remove')
                .restrict(Player.LEVEL_ADMINISTRATOR)
                .parameters([{ name: 'id', type: CommandBuilder.NUMBER_PARAMETER }])
                .build(HouseCommands.prototype.onHouseRemoveCommand.bind(this))
            .sub('save')
                .restrict(Player.LEVEL_ADMINISTRATOR)
                .build(HouseCommands.prototype.onHouseSaveCommand.bind(this))
            .sub('settings')
                .build(HouseCommands.prototype.onHouseSettingsCommand.bind(this))
            .build(HouseCommands.prototype.onHouseCommand.bind(this));
    }

    // Called when a player types the `/house buy` command to start purchasing a house. They must be
    // standing in a house entrance in order for the command to work.
    async onHouseBuyCommand(player) {
        const location = this.manager_.getCurrentLocationForPlayer(player);
        if (!location) {
            player.sendMessage(Message.HOUSE_BUY_NO_LOCATION);
            return;
        }

        if (!location.isAvailable()) {
            player.sendMessage(Message.HOUSE_BUY_NOT_AVAILABLE, location.owner);
            return;
        }

        const currentHouses = this.manager_.getHousesForPlayer(player);
        if (currentHouses.length > 0) {
            if (currentHouses.length >= this.manager_.getMaximumHouseCountForPlayer(player)) {
                player.sendMessage(Message.HOUSE_BUY_NO_MULTIPLE);
                return;
            }

            let distanceToClosestHouse = Number.MAX_SAFE_INTEGER;
            currentHouses.forEach(existingHouse => {
                const distance = location.position.distanceTo(existingHouse.position);

                distanceToClosestHouse = Math.min(distanceToClosestHouse, distance);
            });

            const minimumDistance = this.manager_.getMinimumHouseDistance(player);
            if (distanceToClosestHouse < minimumDistance) {
                player.sendMessage(Message.HOUSE_BUY_TOO_CLOSE, minimumDistance);
                return;
            }
        }

        // |location| is available for purchase, and the |player| hasn't exceeded their house limit
        // nor has an house in the immediate environment.

        const balance = await PlayerMoneyBridge.getBalanceForPlayer(player);

        const interiorList = InteriorList.forEconomy(player, this.economy_(), location);
        const interior = await InteriorSelector.select(player, balance, interiorList);
        if (!interior)
            return;

        // Revalidate that the player has sufficient money available to buy the house. This works
        // around their bank value changes whilst they're in the interior selector.
        const refreshedBalance = await PlayerMoneyBridge.getBalanceForPlayer(player);
        if (interior.price > refreshedBalance) {
            player.sendMessage(Message.HOUSE_BUY_NOT_ENOUGH_MONEY, interior.price);
            return;
        }

        // Withdraw the cost of this house from the |player|'s bank account.
        await PlayerMoneyBridge.setBalanceForPlayer(player, refreshedBalance - interior.price);

        // Actually claim the house within the HouseManager, which writes it to the database.
        await this.manager_.createHouse(player, location, interior.id);

        this.announce_().announceToAdministrators(
            Message.HOUSE_ANNOUNCE_PURCHASED, player.name, player.id, interior.price);

        // Display a confirmation dialog to the player to inform them of their action.
        await MessageBox.display(player, {
            title: 'Congratulations on your purchase!',
            message: Message.HOUSE_BUY_CONFIRMED
        });
    }

    // Called when a |player| types the `/house cancel` command in response to an interactive
    // operation, for instance whilst adding a parking lot.
    onHouseCancelCommand(player) {
        if (this.parkingLotCreator_.isSelecting(player))
            this.parkingLotCreator_.cancelSelection(player);
        else if (this.parkingLotRemover_.isSelecting(player))
            this.parkingLotRemover_.cancelSelection(player);
        else
            player.sendMessage(Message.HOUSE_CANCEL_UNKNOWN);
    }

    // Called when an administrator types `/house create`. It will confirm with them whether they
    // do want to create a house at their current location, together with the price range for which
    // the house will be on offer to players.
    async onHouseCreateCommand(player) {
        const position = player.position;

        // Certain areas are considered to be of high strategic value, and only allow for limited
        // residential activity. Houses should be maintained by players elsewhere.
        if (this.economy_().isResidentialExclusionZone(position)) {
            const rightButton = player.isManagement() ? 'Override' : '';
            const confirmation =
                await Dialog.displayMessage(
                    player, 'Create a new house location',
                    Message.format(Message.HOUSE_CREATE_RESIDENTIAL_EXCLUSION_ZONE),
                    'Close' /* leftButton */, rightButton);

            if (!player.isManagement() || confirmation.response)
                return;
        }

        const minimumPrice = this.economy_().calculateHousePrice(position, 0 /* parkingLotCount */,
                                                                 0 /* interiorValue */);
        const maximumPrice = this.economy_().calculateHousePrice(position, 0 /* parkingLotCount */,
                                                                 9 /* interiorValue */);

        const confirmation =
            await Dialog.displayMessage(player, 'Create a new house location',
                                        Message.format(Message.HOUSE_CREATE_CONFIRM, minimumPrice,
                                                                                     maximumPrice),
                                        'Yes' /* leftButton */, 'No' /* rightButton */);

        if (!confirmation.response)
            return;

        const facingAngle = player.rotation;
        const interiorId = player.interiorId;

        await this.manager_.createLocation(player, { facingAngle, interiorId, position });

        // Announce creation of the location to other administrators.
        this.announce_().announceToAdministrators(
            Message.HOUSE_ANNOUNCE_CREATED, player.name, player.id);

        // Display a confirmation dialog to the player to inform them of their action.
        await MessageBox.display(player, {
            title: 'Create a new house location',
            message: Message.HOUSE_CREATE_CONFIRMED
        });
    }

    // Called when an administrator wants to override the access restrictions to a house and gain
    // entry to it anyway. Only works when they're standing in an entrance point.
    async onHouseEnterCommand(player) {
        const location = await this.manager_.findClosestLocation(player, { maximumDistance: 15 });
        if (location && !location.isAvailable()) {
            // TODO: Should we announce this to the other administrators? We really need
            // announcement channels to deal with the granularity of messages. (Issue #271.)
            this.manager_.forceEnterHouse(player, location);

            player.sendMessage(Message.HOUSE_ENTERED);
            return;
        }

        player.sendMessage(Message.HOUSE_ENTER_NONE_NEAR);
    }

    // Called when a player types `/house goto`. Administrators get a list of house owners to choose
    // from, optionally |filter|ed, after which they get a list of houses owned by the subject.
    // Players using this command will get their own dialog immediately.
    async onHouseGotoCommand(player, filter) {
        if(player.virtualWorld != 0)
            return player.sendMessage(Message.HOUSE_BUY_NO_LOCATION);

        if(player.state == Player.STATE_WASTED || player.state == Player.STATE_SPECTATING)
            return player.sendMessage(Message.WASTED_MESSAGE);

        if (!player.isRegistered()) {
            player.sendMessage(Message.HOUSE_GOTO_UNREGISTERED);
            return;
        }

        if (!player.isAdministrator())
            return await this.displayHouseGotoDialog(player, player.userId);

        const potentialPlayerId = parseFloat(filter);

        // Fast-path to display another player's houses when |filter| is a player Id.
        if (!isNaN(potentialPlayerId) && isFinite(potentialPlayerId)) {
            const subject = server.playerManager.getById(potentialPlayerId);
            if (!subject || !subject.isRegistered()) {
                player.sendMessage(Message.HOUSE_GOTO_NONE_FOUND);
                return;
            }

            return await this.displayHouseGotoDialog(player, subject.userId);
        }

        const menu = new Menu('Select a house owner', ['Nickname', 'Owned houses']);
        const normalizedFilter = filter ? filter.toLowerCase() : null;
        const housesByOwner = new Map();

        // Load all occupied houses in to |housesByOwner|, keyed by the owner's nickname, valued by
        // a dictionary containing their user Id and number of owned houses.
        for (const location of this.manager_.locations) {
            if (location.isAvailable())
                continue;

            const normalizedOwnerName = location.settings.ownerName.toLowerCase();

            if (filter && !normalizedOwnerName.includes(normalizedFilter))
                continue;

            if (!housesByOwner.has(normalizedOwnerName)) {
                housesByOwner.set(normalizedOwnerName, {
                    nickname: location.settings.ownerName,
                    userId: location.settings.ownerId,
                    count: 0
                });
            }

            housesByOwner.get(normalizedOwnerName).count++;
        }

        // Display an error message if an invalid |filter| had been applied.
        if (filter && !housesByOwner.size) {
            player.sendMessage(Message.HOUSE_GOTO_INVALID_FILTER, filter);
            return;
        }

        // Fast-track to the actual dialog if only a single home owner was found.
        if (filter && housesByOwner.size === 1) {
            const { nickname, userId, count } = Array.from(housesByOwner.values())[0];
            return await this.displayHouseGotoDialog(player, userId);
        }

        // Order the owners by their normalized nickname, then add them as a list to the |menu|.
        Array.from(housesByOwner.keys()).sort().forEach(normalizedNickname => {
            const { nickname, userId, count } = housesByOwner.get(normalizedNickname);

            menu.addItem(nickname, count, async(player) =>
                await this.displayHouseGotoDialog(player, userId));
        });

        await menu.displayForPlayer(player);
    }

    // Displays the dialog that allows players to go to a specific house. An error will be shown
    // when the player represented by |userId| does not own any houses.
    async displayHouseGotoDialog(player, userId) {
        const houses = new Set();
        let nickname = null;

        const teleportStatus = this.abuse_().canTeleport(player, { enforceTimeLimit: true });

        // Bail out if the |player| is not currently allowed to teleport.
        if (!teleportStatus.allowed) {
            player.sendMessage(Message.HOUSE_GOTO_TELEPORT_BLOCKED, teleportStatus.reason);
            return;
        }

        // Find the houses owned by |userId|. This operation is O(n) on the number of locations.
        for (const location of this.manager_.locations) {
            if (location.isAvailable())
                continue;

            if (location.settings.ownerId != userId)
                continue;

            nickname = location.settings.ownerName;
            houses.add(location);
        }

        // Display an error message if the |userId| does not own any houses.
        if (!houses.size) {
            player.sendMessage(Message.HOUSE_GOTO_NONE_FOUND);
            return;
        }

        // Display a menu with the player's houses. Selecting one will teleport the |player| inside.
        const menu = new Menu(nickname + '\'s houses');

        for (const location of houses) {
            menu.addItem(location.settings.name, player => {
                this.manager_.forceEnterHouse(player, location);

                this.abuse_().reportTimeThrottledTeleport(player);

                // Announce creation of the location to other administrators.
                this.announce_().announceToAdministrators(
                    Message.HOUSE_ANNOUNCE_TELEPORTED, player.name, player.id);
            });
        }

        await menu.displayForPlayer(player);
    }

    // Called when a Management member uses `/house interior` to teleport to a particular house
    // interior. Restrictions will be ignored, and there won't be a way back for them.
    onHouseInteriorCommand(player, interiorId) {
        if (!InteriorList.isValid(interiorId)) {
            player.sendMessage(Message.HOUSE_INTERIOR_INVALID, interiorId);
            return;
        }

        const interiorData = InteriorList.getById(interiorId);

        player.position = new Vector(...interiorData.exits[0].position);
        player.rotation = interiorData.exits[0].rotation;

        player.interiorId = interiorData.interior;
        player.virtualWorld = VirtualWorld.forPlayer(player);

        player.resetCamera();

        player.sendMessage(Message.HOUSE_INTERIOR_TELEPORTED, interiorData.name);
    }

    // Called when an administrator types the `/house modify` command to change settings for the
    // house closest to their location, allowing them to, for example, add or remove parking lots.
    async onHouseModifyCommand(player) {
        const closestLocation =
            await this.manager_.findClosestLocation(player, { maximumDistance: 15 });

        if (!closestLocation) {
            player.sendMessage(Message.HOUSE_MODIFY_NONE_NEAR);
            return;
        }

        // Create a beam for |player| at the house's entrance to clarify what's being edited.
        const identityBeam = new IdentityBeam(closestLocation.position.translate({ z: -10 }), {
            timeout: IdentityBeamDisplayTimeMs,
            player: player
        });

        const menu = new Menu('What do you want to modify?');

        menu.addItem('Add a parking lot', async(player) => {
            await MessageBox.display(player, {
                title: 'Add a parking lot',
                message: Message.format(Message.HOUSE_PARKING_LOT_ADD,
                                        this.parkingLotCreator_.maxDistance)
            });

            player.sendMessage(Message.HOUSE_PARKING_LOT_ADD_MSG);

            const parkingLot = await this.parkingLotCreator_.select(player, closestLocation);
            if (!parkingLot)
                return;

            await this.manager_.createLocationParkingLot(player, closestLocation, parkingLot);

            // TODO: Should we announce this to the other administrators? We really need
            // announcement channels to deal with the granularity of messages. (Issue #271.)

            await MessageBox.display(player, {
                title: 'Add a parking lot',
                message: Message.HOUSE_PARKING_LOT_ADDED
            });
        });

        const removeParkingLotTitle =
            'Remove a parking lot ({FFFF00}' + closestLocation.parkingLotCount + '{FFFFFF})';

        menu.addItem(removeParkingLotTitle, async(player) => {
            if (!closestLocation.parkingLotCount) {
                return await MessageBox.display(player, {
                    title: 'Remove a parking lot',
                    message: Message.HOUSE_PARKING_LOT_NONE
                });
            }

            await MessageBox.display(player, {
                title: 'Remove a parking lot',
                message: Message.HOUSE_PARKING_LOT_REMOVE
            });

            player.sendMessage(Message.HOUSE_PARKING_LOT_REMOVE_MSG);

            const parkingLot = await this.parkingLotRemover_.select(player, closestLocation);
            if (!parkingLot)
                return;

            await this.manager_.removeLocationParkingLot(closestLocation, parkingLot);

            // TODO: Should we announce this to the other administrators? We really need
            // announcement channels to deal with the granularity of messages. (Issue #271.)

            await MessageBox.display(player, {
                title: 'Remove a parking lot',
                message: Message.HOUSE_PARKING_LOT_REMOVED
            });
        });

        // Give house extensions the ability to provide their additional functionality.
        this.manager_.invokeExtensions('onHouseModifyCommand', player, closestLocation, menu);

        if (!closestLocation.isAvailable()) {
            const ownerName = closestLocation.settings.ownerName;

            menu.addItem('Evict the owner ({FFFF00}' + ownerName + '{FFFFFF})', async(player) => {
                const confirmation =
                    await Dialog.displayMessage(
                        player, 'Evict the current owner',
                        Message.format(Message.HOUSE_MODIFY_EVICT_CONFIRM, ownerName),
                        'Yes' /* leftButton */, 'No' /* rightButton */);

                if (!confirmation.response)
                    return;

                await this.manager_.removeHouse(closestLocation);

                // Announce eviction of the previous owner to other administrators.
                this.announce_().announceToAdministrators(
                    Message.HOUSE_ANNOUNCE_EVICTED, player.name, player.id, ownerName,
                    closestLocation.id);

                // Display a confirmation dialog to the player to inform them of their action.
                await MessageBox.display(player, {
                    title: 'Evict the current owner',
                    message: Message.format(Message.HOUSE_MODIFY_EVICT_CONFIRMED, ownerName)
                });
            });
        }

        menu.addItem('Delete the location', async(player) => {
            const confirmation =
                await Dialog.displayMessage(player, 'Delete the house location',
                                            Message.format(Message.HOUSE_MODIFY_DELETE_CONFIRM),
                                            'Yes' /* leftButton */, 'No' /* rightButton */);

            if (!confirmation.response)
                return;

            await this.manager_.removeLocation(closestLocation);

            // Announce creation of the location to other administrators.
            this.announce_().announceToAdministrators(
                Message.HOUSE_ANNOUNCE_DELETED, player.name, player.id, closestLocation.id);

            // Display a confirmation dialog to the player to inform them of their action.
            await MessageBox.display(player, {
                title: 'Delete the house location',
                message: Message.HOUSE_MODIFY_DELETE_CONFIRMED
            });
        });

        await menu.displayForPlayer(player);

        // Remove the identity beam that was displayed for this house.
        identityBeam.dispose();
    }

    // Called when a |player| types the `/house remove` command with the given |id|. Will find the
    // in-progress interactive operation that should receive this value.
    onHouseRemoveCommand(player, id) {
        if (this.parkingLotRemover_.isSelecting(player))
            this.parkingLotRemover_.confirmSelection(player, id);
        else
            player.sendMessage(Message.HOUSE_REMOVE_UNKNOWN);
    }

    // Called when a |player| types the `/house save` command in response to an interactive
    // operation, for instance whilst adding a parking lot.
    onHouseSaveCommand(player) {
        if (this.parkingLotCreator_.isSelecting(player))
            this.parkingLotCreator_.confirmSelection(player);
        else
            player.sendMessage(Message.HOUSE_SAVE_UNKNOWN);
    }

    // Called when the |player| types `/house settings`. This enables them to change properties of
    // the house that they're presently located in. Not to be confused with `/house modify`, which
    // is meant to be used for the exterior aspects of a house.
    async onHouseSettingsCommand(player) {
        const location = this.manager_.getCurrentHouseForPlayer(player);
        if (!location || location.isAvailable()) {
            player.sendMessage(Message.HOUSE_SETTINGS_OUTSIDE);
            return;
        }

        const isOwner = location.settings.ownerId === player.userId;
        if (!isOwner && !player.isAdministrator()) {
            player.sendMessage(Message.HOUSE_SETTINGS_NOT_OWNER);
            return;
        }

        const menu = new Menu('What would you like to modify?', ['Option', 'Current value']);

        const accessValue = this.toHouseAccessLabel(location.settings.access);
        const vehicleValue = '{FFFF00}' + location.settings.vehicles.size;

        menu.addItem('Change the access level', accessValue, async(player) => {
            const accessMenu = new Menu('Who should be able to access your house?');
            const accessLevels = [
                HouseSettings.ACCESS_EVERYBODY,
                HouseSettings.ACCESS_FRIENDS_AND_GANG,
                HouseSettings.ACCESS_FRIENDS,
                HouseSettings.ACCESS_PERSONAL
            ];

            accessLevels.forEach(level => {
                const labelPrefix = location.settings.access === level ? '{FFFF00}' : '';
                const label = labelPrefix + this.toHouseAccessLabel(level);

                // Add the menu item for the |level| to the sub-menu shown to the player.
                accessMenu.addItem(label, async(player) => {
                    await this.manager_.updateHouseSetting(location, 'access', level);

                    // Change casing of the |label| so that it gramatically works in the message.
                    const confirmationLabel =
                        label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();

                    // Display a confirmation dialog to the player to inform them of their action.
                    await MessageBox.display(player, {
                        title: 'Changing the access level',
                        message: Message.format(Message.HOUSE_SETTINGS_LEVEL, confirmationLabel)
                    });
                });
            });

            // Show the access sub-menu to the player.
            await accessMenu.displayForPlayer(player);
        });

        menu.addItem('Manage your vehicles', vehicleValue, async(player) => {
            await this.onHouseSettingsVehicles(player, location);
        });

        // Give house extensions the ability to provide their additional functionality.
        this.manager_.invokeExtensions('onHouseSettingsCommand', player, location, menu);

        menu.addItem('Sell this house', '-', async(player) => {
            const offer = this.economy_().calculateHouseValue(
                location.position, location.parkingLotCount, location.interior.getData().value,
                Math.floor(server.clock.currentTime() / 1000) - location.settings.purchaseTime);

            const message = isOwner ? Message.format(Message.HOUSE_SETTINGS_SELL_OFFER, offer)
                                    : Message.format(Message.HOUSE_SETTINGS_SELL_CONFIRM,
                                                     location.settings.ownerName);

            const confirmation =
                await Dialog.displayMessage(player, 'Selling the house', message, 
                                            'Yes' /* leftButton */, 'No' /* rightButton */);

            if (!confirmation.response)
                return;

            this.announce_().announceToAdministrators(
                Message.HOUSE_ANNOUNCE_SOLD, player.name, player.id, location.settings.name,
                location.settings.id);

            await this.manager_.removeHouse(location);

            if (isOwner) {
                const balance = await PlayerMoneyBridge.getBalanceForPlayer(player);

                await PlayerMoneyBridge.setBalanceForPlayer(player, balance + offer);
            }

            // Display a confirmation dialog to the player to inform them of their action.
            await MessageBox.display(player, {
                title: 'Congratulations on the sell!',
                message: Message.format(
                    (isOwner ? Message.HOUSE_SETTINGS_SELL_CONFIRMED
                             : Message.HOUSE_SETTINGS_SELL_CONFIRMED_ADMIN), offer)
            });
        });

        await menu.displayForPlayer(player);
    }

    // Called when a player enters the Vehicle section of the `/house settings` command. Allows them
    // to modify the vehicles that are associated with their house.
    async onHouseSettingsVehicles(player, location) {
        if (!location.parkingLotCount) {
            return await MessageBox.display(player, {
                title: 'Unable to modify your vehicles!',
                message: Message.HOUSE_SETTINGS_NO_PARKING_LOTS,
                leftButton: 'Yes',
                rightButton: 'No'
            });
        }

        let index = 0;

        const menu = new Menu('Which parking lot to modify?', ['Parking lot', 'Current vehicle']);

        // TODO: Enable players to select any vehicle through a vehicle selector.
        // https://github.com/LVPlayground/playground/issues/273
        const allowedVehicles = new Map([
            [481, 'BMX'],
            [589, 'Club'],
            [480, 'Comet'],
            [562, 'Elegy'],
            [587, 'Euros'],
            [521, 'FCR-900'],
            [400, 'Landstalker'],
            [522, 'NRG-500'],
            [411, 'Infernus'],
            [451, 'Turismo']
        ]);

        // Create the initial dialog, displaying a list of their parking lots.        
        for (const parkingLot of location.parkingLots) {
            const vehicle = location.settings.vehicles.get(parkingLot);
            const vehicleLabel = vehicle ? '{FFFF00}' + allowedVehicles.get(vehicle.modelId)
                                         : '-';

            // Add a menu item for the vehicle that may or may not be in this parking lot.
            menu.addItem('Parking lot #' + (++index), vehicleLabel, async(player) => {
                if (vehicle /* isOccupied */) {
                    const message = Message.format(Message.HOUSE_SETTINGS_VEHICLE_SELL,
                                                   allowedVehicles.get(vehicle.modelId));

                    const confirmation =
                        await Dialog.displayMessage(player, 'Dispose of your vehicle?', message, 
                                                    'Yes' /* leftButton */, 'No' /* rightButton */);

                    if (!confirmation.response)
                        return;

                    await this.manager_.removeVehicle(location, parkingLot, vehicle);

                    // Display a confirmation dialog to the player to inform them of their action.
                    return await MessageBox.display(player, {
                        title: 'The vehicle has been disposed of!',
                        message: Message.HOUSE_SETTINGS_VEHICLE_SOLD
                    });
                }

                // Create the purchase menu that enables players to purchase a vehicle.
                const purchaseMenu =
                    new Menu('Which vehicle do you want to buy?', ['Vehicle', 'Price']);

                for (const [modelId, modelName] of allowedVehicles) {
                    const price = 0;

                    // TODO: Actually charge money for the vehicles.
                    purchaseMenu.addItem(modelName, Message.formatPrice(price), async(player) => {
                        await this.manager_.createVehicle(location, parkingLot, {
                            modelId: modelId
                        });

                        const message =
                            Message.format('You have successfully purchased a %s! The vehicle is ' +
                                           'waiting for you outside.', modelName);

                        // TODO: Inform administrators of the new vehicle.

                        // Display a confirmation dialog to the player to inform them.
                        await MessageBox.display(player, {
                            title: 'The vehicle has been purchased!',
                            message: message
                        });
                    });
                }

                await purchaseMenu.displayForPlayer(player);
            });
        }

        await menu.displayForPlayer(player);
    }

    // Called when an administrator types the `/house` command. Gives an overview of the available
    // options, with information on how to use the command, depending on the |player|'s level.
    onHouseCommand(player) {
        player.sendMessage(Message.HOUSE_HEADER);
        player.sendMessage(Message.HOUSE_INFO_1);
        player.sendMessage(Message.HOUSE_INFO_2);

        let options = ['buy', 'goto', 'settings'];

        if (player.isAdministrator())
            options.push('create', 'enter', 'modify');
        if (player.isManagement())
            options.push('interior');

        player.sendMessage(Message.COMMAND_USAGE, '/house [' + options.sort().join('/') + ']');
    }

    // ---------------------------------------------------------------------------------------------

    // Returns the menu label to use for enabling players to change the access level of their house.
    toHouseAccessLabel(value) {
        switch (value) {
            case HouseSettings.ACCESS_EVERYBODY:
                return 'All players';
            case HouseSettings.ACCESS_FRIENDS_AND_GANG:
                return 'Your friends and fellow gang members';
            case HouseSettings.ACCESS_FRIENDS:
                return 'Your friends';
            case HouseSettings.ACCESS_PERSONAL:
                return 'Only you';
            default:
                throw new Error('Invalid house access value: ' + value);
        }
    }

    // Registers the `/house` command as one tracked by the `/lvp access` list.
    registerTrackedCommands(playground) {
        playground.registerCommand('house', Player.LEVEL_PLAYER);
    }

    // ---------------------------------------------------------------------------------------------

    dispose() {
        server.commandManager.removeCommand('house');

        this.playground_().unregisterCommand('house');

        this.parkingLotCreator_.dispose();
        this.parkingLotCreator_ = null;

        this.parkingLotRemover_.dispose();
        this.parkingLotRemover_ = null;

        this.economy_ = null;
        this.announce_ = null;

        this.manager_ = null;
    }
}

exports = HouseCommands;
