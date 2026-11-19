import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, GeoJSON, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import geo from '../geo/khagaria.json'
import { sliceLine } from '../geo/line'
import { DEMO } from '../api'
import { useT } from '../strings'

export function workColor(w) {
  if (w.flags?.some(f => f.severity === 3)) return '#B42318'
  if (w.flags?.length) return '#D9A21B'
  if (w.status === 'USABLE_VERIFIED') return '#2E7D4F'
  return '#2457C5'
}

const blockFC = { type: 'FeatureCollection', features: geo.blocks.map(b => ({ type: 'Feature', properties: { name: b.name, lgd: b.lgd, area: b.area_km2 }, geometry: b.geometry })) }
const line = (arr) => ({ type: 'FeatureCollection', features: arr.map(r => ({ type: 'Feature', properties: { name: r.name }, geometry: r.geometry })) })
const riversFC = line(geo.rivers), roadsFC = line(geo.roads), railFC = line(geo.rail)
const HQ = [25.5022, 86.4671]

function Fit({ focus, bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false })
    else if (focus) map.setView(focus, 11, { animate: false })
    else map.fitBounds(geo.bounds, { padding: [8, 8], animate: false })
  }, [map, focus, bounds])
  return null
}

/**
 * Real map of Khagaria: block boundaries (LGD), Ganga and Kosi, national highway, railway.
 * District view: works coloured by state, roads and drains drawn along their alignment.
 * Work view (coverage): the measured stretch, stretches without site photos, and where each photo was taken.
 */
export default function KhagariaMap({ works, height = 420, selectedBlock, onBlockClick, focus, coverage }) {
  const nav = useNavigate()
  const { L: T, lang } = useT()
  const blockStyle = useMemo(() => (f) => {
    const sel = selectedBlock === f.properties.name
    return { color: '#5B6B80', weight: sel ? 2.5 : 1.2, fillColor: sel ? '#DCE6F7' : '#F7F5EE', fillOpacity: DEMO ? 1 : (sel ? .45 : .25) }
  }, [selectedBlock])
  const single = works.length === 1 ? works[0] : null
  const bounds = single?.line ? single.line : null

  return (
    <MapContainer bounds={geo.bounds} style={{ height }} className="kmap" scrollWheelZoom={false} zoomSnap={0.25} attributionControl={!DEMO}>
      <Fit focus={focus} bounds={bounds} />
      {!DEMO && <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}
      <GeoJSON key={`b-${selectedBlock || ''}-${lang}`} data={blockFC} style={blockStyle}
        onEachFeature={(f, layer) => {
          layer.on('click', () => onBlockClick?.(f.properties.name))
          layer.bindTooltip(`${f.properties.name} ${lang === 'hi' ? 'प्रखंड' : 'block'}, ${f.properties.area} km², LGD ${f.properties.lgd}`, { sticky: true, className: 'ktip' })
        }} />
      <GeoJSON data={riversFC} style={{ color: '#6FA8D6', weight: 5, opacity: .9 }} interactive={false} />
      <GeoJSON data={railFC} style={{ color: '#4A5565', weight: 1.5, dashArray: '5 4' }} interactive={false} />
      <GeoJSON data={roadsFC} style={{ color: '#C2410C', weight: 2.5, opacity: .85 }} interactive={false} />
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: 'none' }}>
        {!single && geo.blocks.map(b => (
          <Marker key={b.name} position={b.label} interactive={false} pane="labels" icon={L.divIcon({ className: 'klabel', html: `<span>${b.name}</span>`, iconSize: [0, 0] })} />
        ))}
        {!single && <>
          <Marker position={[25.335, 86.36]} interactive={false} pane="labels" icon={L.divIcon({ className: 'klabel river', html: `<span>${lang === 'hi' ? 'गंगा' : 'Ganga'}</span>`, iconSize: [0, 0] })} />
          <Marker position={[25.62, 86.79]} interactive={false} pane="labels" icon={L.divIcon({ className: 'klabel river', html: `<span>${lang === 'hi' ? 'कोसी' : 'Kosi'}</span>`, iconSize: [0, 0] })} />
        </>}
      </Pane>
      {!single && (
        <CircleMarker center={HQ} radius={4} pathOptions={{ color: '#17202B', weight: 1.5, fillColor: '#fff', fillOpacity: 1 }}>
          <Tooltip direction="right" offset={[6, 0]} className="ktip">{lang === 'hi' ? 'खगड़िया शहर (जिला मुख्यालय)' : 'Khagaria town (district headquarters)'}</Tooltip>
        </CircleMarker>
      )}

      {/* alignments */}
      {works.filter(w => w.line).map(w => (
        <Polyline key={`l-${w.code}`} positions={w.line} interactive={false}
          pathOptions={single ? { color: '#9AA6B6', weight: 6, opacity: .7, lineCap: 'round' } : { color: workColor(w), weight: 3, opacity: .85 }} />
      ))}
      {single && coverage && single.line && <>
        {coverage.executed.map(([a, b], i) => <Polyline key={`e${i}`} positions={sliceLine(single.line, a, b)} interactive={false} pathOptions={{ color: '#2457C5', weight: 6, lineCap: 'round' }} />)}
        {coverage.gaps.map(([a, b], i) => (
          <Polyline key={`g${i}`} positions={sliceLine(single.line, a, b)} pathOptions={{ color: '#B42318', weight: 7, dashArray: '8 7', lineCap: 'butt' }}>
            <Tooltip sticky className="ktip">{T.gaps(`${a.toFixed(1)}–${b.toFixed(1)}`)}</Tooltip>
          </Polyline>
        ))}
        {coverage.photos.map(p => (
          <CircleMarker key={`p${p.id}`} center={[p.lat, p.lng]} radius={5} pathOptions={{ color: '#fff', weight: 2, fillColor: p.in_geofence === false ? '#B42318' : '#16202C', fillOpacity: 1 }}>
            <Tooltip className="ktip">{p.caption}{p.chainage_km != null ? ` (km ${p.chainage_km.toFixed(2)})` : ''}</Tooltip>
          </CircleMarker>
        ))}
      </>}

      {works.map(w => (
        <CircleMarker key={w.code} center={[w.lat, w.lng]} radius={single ? 8 : 7}
          pathOptions={{ color: '#fff', weight: 2, fillColor: workColor(w), fillOpacity: single?.line ? 0 : 1, opacity: single?.line ? 0 : 1 }}
          eventHandlers={{ click: () => !single && w.id && nav(`/works/${w.id}`) }}>
          {!single && (
            <Tooltip className="ktip" direction="top" offset={[0, -6]}>
              <b>{w.code}</b> {w.name}{w.flags?.length ? <><br />{lang === 'hi' ? w.flags[0].message_hi : w.flags[0].message}</> : null}
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </MapContainer>
  )
}

export function MapLegend({ coverage }) {
  const { L } = useT()
  const g = L.legend
  return (
    <ul className="maplegend" aria-label="Map legend">
      {coverage ? <>
        <li><i className="ln" style={{ borderColor: '#2457C5', borderTopWidth: 4 }} />{g.covered}</li>
        <li><i className="ln dash" style={{ borderColor: '#B42318', borderTopWidth: 4 }} />{g.gap}</li>
        <li><i className="dot" style={{ background: '#16202C' }} />{L.evType.photo}</li>
      </> : <>
        <li><i className="dot" style={{ background: '#B42318' }} />{g.serious}</li>
        <li><i className="dot" style={{ background: '#D9A21B' }} />{g.attention}</li>
        <li><i className="dot" style={{ background: '#2457C5' }} />{g.onTrack}</li>
        <li><i className="dot" style={{ background: '#2E7D4F' }} />{g.usable}</li>
      </>}
      <li><i className="ln" style={{ borderColor: '#6FA8D6', borderTopWidth: 4 }} />{g.river}</li>
      <li><i className="ln" style={{ borderColor: '#C2410C' }} />{g.highway}</li>
      <li><i className="ln dash" style={{ borderColor: '#4A5565' }} />{g.rail}</li>
    </ul>
  )
}
