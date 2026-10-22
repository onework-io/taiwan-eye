import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Startup view for the Taiwan edition: open on the whole island, then fly in
 * to Taipei 101.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToTaiwan(viewer) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.95, 23.7, 900000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      // ~2.2 km south-south-east of Taipei 101, looking north-west at it.
      destination: Cesium.Cartesian3.fromDegrees(121.5745, 25.0175, 1200),
      orientation: {
        heading: Cesium.Math.toRadians(330),
        pitch: Cesium.Math.toRadians(-18),
        roll: 0.0,
      },
      duration: 5.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}

/**
 * Frame the whole of Taiwan (the first-run 台灣水情 tile), tilted a little so
 * reservoir and river labels read as a map rather than a flat sheet.
 */
export function flyToTaiwanOverview(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(120.95, 21.2, 430000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-58),
      roll: 0.0,
    },
    duration: 3.5,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/** Upstream name, kept so upstream tests and callers still resolve. */
export const flyToAustin = flyToTaiwan;
