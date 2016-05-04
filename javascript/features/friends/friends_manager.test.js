// Copyright 2016 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the MIT license, a copy of which can
// be found in the LICENSE file.

const FriendsManager = require('features/friends/friends_manager.js');
const MockFriendsDatabase = require('features/friends/test/mock_friends_database.js');
const MockServer = require('test/mock_server.js');

describe('FriendsManager', (it, beforeEach, afterEach) => {
    let gunther = null;
    let russell = null;

    // The friendsManager instance to use for the tests. Will be reset after each test.
    let friendsManager = null;

    MockServer.bindTo(beforeEach, afterEach,
        () => {
            gunther = server.playerManager.getById(0 /* Gunther */);
            russell = server.playerManager.getById(1 /* Russell */);

            friendsManager = new FriendsManager(null /* database */);
            friendsManager.database_ = new MockFriendsDatabase();

        }, () => {
            friendsManager.dispose();
        });

    it('should load the list of friends when a player logs in', assert => {
        gunther.identify({ userId: 50 });
        russell.identify({ userId: 1337 });

        assert.isTrue(gunther.isRegistered());
        assert.isTrue(russell.isRegistered());

        return friendsManager.getFriends(gunther).then(friends => {
            assert.equal(friends.online.length, 1);
            assert.equal(friends.online[0], 'Russell');

            assert.equal(friends.offline.length, 1);
            assert.equal(friends.offline[0], 'Lucy');
        });
    });

    it('should play a sound when a friend connects to the server', assert => {
        gunther.identify({ userId: 50 });

        return friendsManager.getFriends(gunther).then(friends => {
            assert.equal(friends.offline.length, 2);
            assert.equal(friends.offline[0], 'Lucy');
            assert.equal(friends.offline[1], 'Russell');

            assert.isNull(gunther.lastPlayedSound);

            server.playerManager.onPlayerConnect({ playerid: 100, name: 'Lucy' });

            assert.isNotNull(gunther.lastPlayedSound);
        });
    });

    it('should remove stored data when a player disconnects', assert => {
        gunther.identify();
        russell.identify();

        assert.isTrue(gunther.isRegistered());
        assert.isTrue(russell.isRegistered());

        return friendsManager.getFriends(gunther).then(friends => {
            assert.isTrue(friendsManager.friends_.has(gunther));
            assert.isTrue(friendsManager.loadPromises_.has(gunther));
            assert.isTrue(friendsManager.lastActive_.hasOwnProperty(gunther.userId));
            assert.equal(
                friendsManager.lastActive_[gunther.userId], FriendsManager.CURRENTLY_ONLINE);

            gunther.disconnect();

            assert.isFalse(friendsManager.friends_.has(gunther));
            assert.isFalse(friendsManager.loadPromises_.has(gunther));
            assert.isTrue(friendsManager.lastActive_.hasOwnProperty(gunther.userId));
            assert.notEqual(
                friendsManager.lastActive_[gunther.userId], FriendsManager.CURRENTLY_ONLINE);
        });
    });
});