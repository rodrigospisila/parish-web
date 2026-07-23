import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Corrige os ícones padrão do Leaflet quando empacotado pelo Vite
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export interface LatLng {
  lat: number;
  lng: number;
}

interface MapPickerProps {
  value: LatLng | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
}

// Centro padrão: Brasil (quando ainda não há coordenada)
const DEFAULT_CENTER: LatLng = { lat: -15.78, lng: -47.93 };

const ClickHandler: React.FC<{ onChange: (lat: number, lng: number) => void }> = ({ onChange }) => {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

const Recenter: React.FC<{ value: LatLng | null }> = ({ value }) => {
  const map = useMap();
  useEffect(() => {
    if (value) {
      map.setView([value.lat, value.lng], Math.max(map.getZoom(), 15));
    }
  }, [value?.lat, value?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};

/**
 * Mini-mapa de seleção de coordenadas (OpenStreetMap/Leaflet).
 * Clique no mapa ou arraste o pino para definir a posição.
 */
const MapPicker: React.FC<MapPickerProps> = ({ value, onChange, height = 260 }) => {
  const center = value ?? DEFAULT_CENTER;
  return (
    <div style={{ height, borderRadius: 10, overflow: 'hidden', border: '1px solid #ddd' }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={value ? 15 : 4}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onChange={onChange} />
        <Recenter value={value} />
        {value && (
          <Marker
            position={[value.lat, value.lng]}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const pos = (e.target as L.Marker).getLatLng();
                onChange(pos.lat, pos.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
};

export default MapPicker;
