// Copyright 2016 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the MIT license, a copy of which can
// be found in the LICENSE file.

const Command = require('features/playground/command.js');
const CommandBuilder = require('components/command_manager/command_builder.js');
const ScopedCallbacks = require('base/scoped_callbacks.js');

// How many frames per second should be checked for directionality updates?
const FramesPerSecond = 20;

// Animation index of the PARACHUTE/FALL_SkyDive_Accel animation.
const MovingAnimationIndex = 959;

// Command: /fly [player]?
class FlyCommand extends Command {
    constructor(...args) {
        super(...args);

        // Map containing all the players who are currently flying, and whether they should continue
        // to fly (typing /fly on a player twice will stop them from flying further).
        this.flying_ = new Map();

        // Listen to onPlayerDeath events in case a flying player dies.
        this.callbacks_ = new ScopedCallbacks();
        this.callbacks_.addEventListener(
            'playerspawn', FlyCommand.prototype.stopFlight.bind(this));
        this.callbacks_.addEventListener(
            'playerdeath', FlyCommand.prototype.stopFlight.bind(this));
    }

    get name() { return 'fly'; }
    get defaultPlayerLevel() { return Player.LEVEL_MANAGEMENT; }

    build(commandBuilder) {
        commandBuilder
            .parameters([
                { name: 'target', type: CommandBuilder.PLAYER_PARAMETER, optional: true }
            ])
            .build(FlyCommand.prototype.onFlyCommand.bind(this));
    }

    async onFlyCommand(player, target) {
        const subject = target || player;
        const name = subject === player ? 'You' : subject.name;

        if (this.flying_.has(subject)) {
            this.flying_.set(subject, false);

            player.sendMessage(Message.COMMAND_SUCCESS, name + ' will momentarily stop flying.');
            return;
        }

        if (player.interiorId != 0 && !player.isManagement()) {
            player.sendMessage(Message.COMMAND_ERROR, name + ' is currently in an interior, ' +
                               'but you can only fly outside!');
            return;
        }

        if(player.virtualWorld != 0 && !player.isManagement()){
            player.sendMessage(Message.COMMAND_ERROR, name + ' is currently taking part of minigame or is not in main world, ' +
                                'but you can only fly in main world');
              return;
        }

        if (subject === player)
            player.sendMessage(Message.COMMAND_SUCCESS, 'You are about to take off, enjoy!');
        else
            player.sendMessage(Message.COMMAND_SUCCESS, name + ' is about to take off.');

        this.flying_.set(subject, true);

        subject.position = subject.position.translate({ z: 5 });

        this.applyFlightAnimation(subject, false /* moving */);

        let velocityFactor = 1;
        while (this.flying_.get(subject) && subject.isConnected()) {
            const keys = subject.getKeys();

            let cameraFrontVector = null;

            let velocityX = 0;
            let velocityY = 0;
            let velocityZ = 0;

            // Move forward.
            if (keys.up) {
                cameraFrontVector = subject.cameraFrontVector;

                velocityX = 0.05 + cameraFrontVector.x;
                velocityY = 0.05 + cameraFrontVector.y;
            }

            // Speed up.
            if (keys.sprint)
                velocityFactor += 0.25;

            // Slow down.
            if (keys.jump)
                velocityFactor = Math.max(0.25, velocityFactor - 0.25);

            // Go up, go down, or remain stationary.
            if (keys.fire)
                velocityZ = 0.5;
            else if (keys.aim)
                velocityZ = -0.3;
            else
                velocityZ = 0.0152 / velocityFactor;

            subject.velocity = new Vector(velocityX * velocityFactor,
                                          velocityY * velocityFactor,
                                          velocityZ * velocityFactor);

            const moving = Math.abs(velocityX) > 0.01 || Math.abs(velocityY) > 0.01;
            if (moving) {
                cameraFrontVector = cameraFrontVector || subject.cameraFrontVector;

                const position = subject.position;
                const targetPosition = subject.cameraPosition.translate({
                    x: 522.48 * cameraFrontVector.x,
                    y: 522.48 * cameraFrontVector.y
                });

                let rotation = Math.abs(Math.atan((targetPosition.y - position.y) /
                                                  (targetPosition.x - position.x)) * 180 / Math.PI);

                if (targetPosition.x <= position.x && targetPosition.y >= position.y)
                    rotation = 180 - rotation;
                else if (targetPosition.x < position.x && targetPosition.y < position.y)
                    rotation = 180 + rotation;
                else if (targetPosition.x >= position.x && targetPosition.y <= position.y)
                    rotation = 360 - rotation;

                subject.rotation = (rotation - 90) % 360;
            }

            // Update the animation with whatever is most recent for the player.
            this.applyFlightAnimation(subject, moving);

            await seconds(1 / FramesPerSecond);
        }

        this.flying_.delete(subject);

        if (!subject.isConnected())
            return;

        // Nudge them to reset any animations and make sure they can control themselves again.
        subject.position = subject.position.translate({ z: 0.1 });
    }

    // Applies the appropriate animation to the |player|  for their current state of flight.
    applyFlightAnimation(player, moving) {
        const animationIndex = player.animationIndex;

        let animationName = null;
        if (!moving && animationIndex != 978 /* PARA_steerR */)
            animationName = 'PARA_steerR';
        else if (moving && animationIndex != 959 /* FALL_SkyDive_Accel */)
            animationName = 'FALL_SkyDive_Accel';

        if (!animationName)
            return;

        player.animate({
            library: 'PARACHUTE',
            name: animationName,
            loop: true,
            lock: true,
            freeze: true,
            forceSync: true
        });
    }

    // Called when a player respawns or dies. They have to stop flying in these situations.
    stopFlight(event) {
        const player = server.playerManager.getById(event.playerid);
        if (!player || !this.flying_.has(player))
            return;  // invalid player, or not currently flying

        // Make them stop flying on the next iteration.
        this.flying_.set(player, false);
    }
}

exports = FlyCommand;
