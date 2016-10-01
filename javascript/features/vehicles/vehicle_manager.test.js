// Copyright 2016 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the MIT license, a copy of which can
// be found in the LICENSE file.

const MockPlayground = require('features/playground/test/mock_playground.js');
const Streamer = require('features/streamer/streamer.js');
const Vehicles = require('features/vehicles/vehicles.js');

describe('VehicleManager', (it, beforeEach) => {
    let gunther = null;
    let manager = null;
    let vehicleStreamer = null;

    // The position at which the test vehicle should be created.
    const POSITION = new Vector(6000, 6000, 6000);

    // Settings required to create a Hydra with the VehicleManager.
    const HYDRA = {
        modelId: 520 /* Hydra */,
        position: POSITION,
        rotation: 90,
        interiorId: 0,
        virtualWorld: 0
    };

    beforeEach(async(assert) => {
        gunther = server.playerManager.getById(0 /* Gunther */);
        gunther.position = POSITION;

        server.featureManager.registerFeaturesForTests({
            playground: MockPlayground,
            streamer: Streamer,
            vehicles: Vehicles
        });

        const vehicles = server.featureManager.loadFeature('vehicles');

        manager = vehicles.manager_;
        await manager.ready;

        vehicleStreamer = server.featureManager.loadFeature('streamer').getVehicleStreamer();
    });

    it('should load vehicle data from the database by default', async(assert) => {
        assert.isAbove(manager.count, 0);

        const vehicles = [...manager.vehicles];
        assert.equal(vehicles.length, manager.count);

        const originalVehicleCount = server.vehicleManager.count;

        // Stream the vehicles. The vehicle closest to |gunther| should be created.
        gunther.position = vehicles[0].position.translate({ z: 2 });
        await vehicleStreamer.stream();

        assert.equal(server.vehicleManager.count, originalVehicleCount + 1);

        // Dispose of the VehicleManager. All created vehicles should be removed.
        manager.dispose();
        manager.dispose = () => true;

        assert.equal(server.vehicleManager.count, originalVehicleCount);
    });

    it('should automatically stream created vehicles in', assert => {
        gunther.position = new Vector(0, 0, 0);
        assert.isNull(manager.createVehicle({
            modelId: 412 /* Infernus */,
            position: new Vector(3000, 3000, 3000),
            rotation: 180,
            interiorId: 0,
            virtualWorld: 0
        }));

        gunther.position = POSITION;
        const vehicle = manager.createVehicle(HYDRA);

        assert.isNotNull(vehicle);
        assert.isTrue(vehicle.isConnected());

        assert.equal(vehicle.modelId, 520 /* Hydra */);
        assert.deepEqual(vehicle.position, POSITION);
        assert.equal(vehicle.rotation, 90);
        assert.equal(vehicle.interiorId, 0);
        assert.equal(vehicle.virtualWorld, 0);
    });

    it('should be able to tell whether it manages a vehicle', assert => {
        const managedVehicle = manager.createVehicle(HYDRA);

        assert.isTrue(managedVehicle.isConnected());
        assert.isTrue(manager.isManagedVehicle(managedVehicle));

        const unmanagedVehicle = server.vehicleManager.createVehicle({
            modelId: 412 /* Infernus */,
            position: new Vector(2500, 3000, 3500)
        });

        assert.isTrue(unmanagedVehicle.isConnected());
        assert.isFalse(manager.isManagedVehicle(unmanagedVehicle));

        // Dispose of the VehicleManager. All managed created vehicles should be removed.
        manager.dispose();
        manager.dispose = () => true;

        assert.isFalse(managedVehicle.isConnected());
        assert.isTrue(unmanagedVehicle.isConnected());
    });

    it('should be able to store new vehicles in the database', async(assert) => {
        const managedVehicle = manager.createVehicle(HYDRA);
        assert.isNotNull(managedVehicle);
        assert.isTrue(managedVehicle.isConnected());

        assert.isFalse(manager.isPersistentVehicle(managedVehicle));

        const updatedVehicle = await manager.storeVehicle(managedVehicle);
        assert.isNotNull(updatedVehicle);

        assert.isFalse(managedVehicle.isConnected());
        assert.isTrue(updatedVehicle.isConnected());

        assert.isTrue(manager.isPersistentVehicle(updatedVehicle));
    });

    it('should be able to update existing vehicles in the database', async(assert) => {
        gunther.position = new Vector(500, 1000, 1500);
        await vehicleStreamer.stream();

        assert.equal(manager.count, 1);

        const managedDatabaseVehicle = [...manager.vehicles][0];
        assert.isTrue(managedDatabaseVehicle.isPersistent());

        const managedVehicle = manager.streamer.getLiveVehicle(managedDatabaseVehicle);
        assert.isNotNull(managedVehicle);
        assert.isTrue(managedVehicle.isConnected());

        const updatedVehicle = await manager.storeVehicle(managedVehicle);
        assert.isNotNull(updatedVehicle);

        assert.equal(manager.count, 1);

        const updatedDatabaseVehicle = [...manager.vehicles][0];
        assert.notEqual(updatedDatabaseVehicle, managedDatabaseVehicle);
        assert.equal(updatedDatabaseVehicle.databaseId, managedDatabaseVehicle.databaseId);
        assert.isTrue(updatedDatabaseVehicle.isPersistent());

        assert.isFalse(managedVehicle.isConnected());
        assert.isTrue(updatedVehicle.isConnected());
    });

    it('should move players over to the updated vehicle automatically', async(assert) => {
        const russell = server.playerManager.getById(1 /* Russell */);
        const lucy = server.playerManager.getById(2 /* Lucy */);

        const vehicle = manager.createVehicle(HYDRA);
        assert.isTrue(vehicle.isConnected());

        gunther.enterVehicle(vehicle, Vehicle.SEAT_DRIVER);
        russell.enterVehicle(vehicle, Vehicle.SEAT_PASSENGER);
        lucy.enterVehicle(vehicle, Vehicle.SEAT_PASSENGER + 2 /* 3rd passenger */);

        assert.equal(gunther.vehicle, vehicle);
        assert.equal(russell.vehicle, vehicle);
        assert.equal(lucy.vehicle, vehicle);

        const updatedVehicle = await manager.storeVehicle(vehicle);
        assert.isNotNull(updatedVehicle);

        assert.isNull(gunther.vehicle);
        assert.isNull(russell.vehicle);
        assert.isNull(lucy.vehicle);

        lucy.disconnect();  // the management should consider this as a signal

        await server.clock.advance(500);  // half a second

        assert.equal(gunther.vehicle, updatedVehicle);
        assert.equal(gunther.vehicleSeat, Vehicle.SEAT_DRIVER);

        assert.equal(russell.vehicle, updatedVehicle);
        assert.equal(russell.vehicleSeat, Vehicle.SEAT_PASSENGER);

        assert.isNull(lucy.vehicle);
    });

    it('should be able to delete vehicles from the game', async(assert) => {
        const vehicle = manager.createVehicle(HYDRA);

        assert.isTrue(vehicle.isConnected());
        assert.isTrue(manager.isManagedVehicle(vehicle));

        const originalVehicleCount = server.vehicleManager.count;

        await manager.deleteVehicle(vehicle);

        assert.isFalse(vehicle.isConnected());
        assert.isFalse(manager.isManagedVehicle(vehicle));

        assert.equal(server.vehicleManager.count, originalVehicleCount - 1);
    });

    it('should be able to pin and unpin managed vehicles in the streamer', assert => {
        const vehicle = manager.createVehicle(HYDRA);

        assert.isTrue(vehicle.isConnected());
        assert.isTrue(manager.isManagedVehicle(vehicle));

        const storedVehicle = Array.from(manager.vehicles).pop();
        assert.equal(storedVehicle.modelId, vehicle.modelId);

        assert.isFalse(manager.streamer.isPinned(storedVehicle));

        manager.pinVehicle(vehicle);

        assert.isTrue(manager.streamer.isPinned(storedVehicle));

        manager.unpinVehicle(vehicle);

        assert.isFalse(manager.streamer.isPinned(storedVehicle));
    });

    it('should recreate vehicles when the streamer reloads', assert => {
        const originalStreamerSize = vehicleStreamer.size;

        assert.isTrue(server.featureManager.isEligibleForLiveReload('streamer'));
        assert.isTrue(server.featureManager.liveReload('streamer'));

        const streamer = server.featureManager.loadFeature('streamer');
        assert.notEqual(streamer.getVehicleStreamer(), vehicleStreamer);
        assert.equal(streamer.getVehicleStreamer().size, originalStreamerSize);
    });
});