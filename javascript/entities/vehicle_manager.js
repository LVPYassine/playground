// Copyright 2016 Las Venturas Playground. All rights reserved.
// Use of this source code is governed by the MIT license, a copy of which can
// be found in the LICENSE file.

const ScopedCallbacks = require('base/scoped_callbacks.js');

// The vehicle manager is in control of all vehicles that have been created by the JavaScript code
// of Las Venturas Playground. It deliberately does not provide access to the Pawn vehicles.
class VehicleManager {
    constructor(vehicleConstructor = Vehicle) {
        this.vehicleConstructor_ = vehicleConstructor;

        this.observers_ = new Set();
        this.vehicles_ = new Map();

        this.callbacks_ = new ScopedCallbacks();
    }

    // Gets the number of vehicles currently created on the server.
    get count() { return this.vehicles_.size; }

    // Returns the vehicle identified by |vehicleId|, or NULL when the vehicle does not exist or
    // is not owned by the JavaScript code.
    getById(vehicleId) {
        if (this.vehicles_.has(vehicleId))
            return this.vehicles_.get(vehicleId);

        return null;
    }

    // Executes the |callback| once for each vehicle that exists on Las Venturas Playground.
    forEach(callback, thisArg = null) {
        this.vehicles_.forEach(callback);
    }

    // Observes events for the vehicles owned by this manager. |observer| can be added multiple
    // times, but will receive events only once.
    addObserver(observer) {
        this.observers_.add(observer);
    }

    // Removes |observer| from the set of objects that will be informed about vehicle events.
    removeObserver(observer) {
        this.observers_.delete(observer);
    }

    // Creates a new vehicle with the given options. The vehicle's model Id and position are
    // required, all other options can optionally be provided.
    createVehicle({ modelId, position, rotation = 0, primaryColor = -1, secondaryColor = -1,
                    siren = false, paintjob = null, interiorId = 0, virtualWorld = 0 } = {}) {
        const vehicle = new this.vehicleConstructor_(this, {
            modelId: modelId,
            position: position,
            rotation: rotation,
            primaryColor: primaryColor,
            secondaryColor: secondaryColor,
            siren: siren,
            paintjob: paintjob,
            interiorId: interiorId,
            virtualWorld: virtualWorld
        });

        this.vehicles_.set(vehicle.id, vehicle);
        return vehicle;
    }

    // Notifies observers about the |eventName|, passing |...args| as the argument to the method
    // when it exists. The call will be bound to the observer's instance.
    notifyObservers(eventName, ...args) {
        for (let observer of this.observers_) {
            if (observer.__proto__.hasOwnProperty(eventName))
                observer.__proto__[eventName].call(observer, ...args);
            else if (observer.hasOwnProperty(eventName))
                observer[eventName].call(observer, ...args);
        }
    }

    // Called when |vehicle| has been disposed. The reference to the vehicle will be released from
    // the vehicle manager, which means that it will be inaccessible from here on out.
    didDisposeVehicle(vehicle) {
        if (!this.vehicles_.has(vehicle.id))
            throw new Error('The vehicle with Id #' + vehicle.id + ' is not known to the manager.');

        this.vehicles_.delete(vehicle.id);
    }

    // Releases all references and state held by the vehicle manager.
    dispose() {
        this.callbacks_.dispose();
        this.callbacks_ = null;

        // Forcefully dispose all vehicles created through JavaScript on the server.
        this.vehicles_.forEach(vehicle => vehicle.dispose());

        if (this.vehicles_.size > 0)
            throw new Error('There are vehicles left in the vehicle manager after disposing it.');

        this.vehicles_ = null;
        this.observers_ = null;
    }
}

exports = VehicleManager;