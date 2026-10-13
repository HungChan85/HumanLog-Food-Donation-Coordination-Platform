import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationPreview, Warehouse } from "./api";

export default function LiveMap({
  location,
  warehouses = [],
  pin,
  onSelect,
  detailed = false,
}: {
  location?: LocationPreview | null;
  warehouses?: Warehouse[];
  pin?: [number, number] | null;
  onSelect?: (point: [number, number]) => void;
  detailed?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current).setView([10.8048, 106.7168], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    map.current = instance;
    layers.current = L.layerGroup().addTo(instance);
    instance.on("click", (event) => select.current?.([event.latlng.lat, event.latlng.lng]));
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !layers.current) return;
    layers.current.clearLayers();
    const points: [number, number][] = [];
    const hubs = location?.warehouses || warehouses;
    hubs.forEach((hub) => {
      const point: [number, number] = [hub.lat, hub.lon];
      points.push(point);
      // bindTooltip receives an element so warehouse text cannot become HTML.
      const label = document.createElement("span");
      label.textContent = hub.name;
      L.circleMarker(point, { radius: 8, color: "#1e4b37", fillOpacity: 0.9 })
        .bindTooltip(label)
        .addTo(layers.current!);
    });
    const origin =
      pin || (location ? ([location.latitude, location.longitude] as [number, number]) : null);
    if (origin) {
      points.push(origin);
      L.circleMarker(origin, { radius: 9, color: "#b77828", fillOpacity: 1 })
        .bindTooltip("Your location")
        .addTo(layers.current);
    }
    if (location?.route?.points.length)
      L.polyline(location.route.points, { color: "#285e46", weight: 5 }).addTo(layers.current);
    if (points.length > 1)
      map.current.fitBounds(L.latLngBounds(points), {
        padding: [35, 35],
        maxZoom: 14,
      });
    else if (origin) map.current.setView(origin, 14);
  }, [location, warehouses, pin]);
  return (
    <div
      ref={container}
      className={`live-map ${detailed ? "live-map-large" : ""}`}
      aria-label={
        onSelect
          ? "OpenStreetMap: click to select your location"
          : "OpenStreetMap warehouse and route map"
      }
    />
  );
}
