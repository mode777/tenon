import { Grid, GizmoHelper, GizmoViewport, OrbitControls, Outlines, TransformControls } from '@react-three/drei'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  directChildren,
  effectiveForType,
  entityById,
  entityIsSceneInstance,
  normalizeScenePath,
  normalizeTransform,
  type EntityTransform,
  type SceneDocument,
  type SceneEntity,
  type SceneValidationContext,
} from '../core/scene'

export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface SceneViewportProps {
  client: AssetReader
  scene: SceneDocument
  context: SceneValidationContext
  selection: string | null
  onSelect: (id: string | null) => void
  onTransform: (id: string, transform: EntityTransform) => void
  mode: TransformMode
  snap: boolean
}

export interface AssetReader {
  readFile(path: string, encoding: 'binary'): Promise<{ bytes: ArrayBuffer }>
}

const DEG = Math.PI / 180

function radians(value: [number, number, number]): [number, number, number] {
  return [value[0] * DEG, value[1] * DEG, value[2] * DEG]
}

function degrees(value: [number, number, number]): [number, number, number] {
  return [value[0] / DEG, value[1] / DEG, value[2] / DEG]
}

function transformProps(transform?: EntityTransform) {
  const normalized = normalizeTransform(transform)
  return {
    position: normalized.position,
    rotation: radians(normalized.rotation),
    scale: normalized.scale,
  }
}

function assetPathFor(entity: SceneEntity, context: SceneValidationContext): string | null {
  if (!entity.type) return null
  const effective = effectiveForType(entity.type, context)
  const field = effective.fields.find((item) => item.field.type === 'assetRef')
  if (!field) return null
  const value = entity.props?.[field.name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const assetCache = new Map<string, Promise<THREE.Object3D>>()

function loadAsset(client: AssetReader, path: string): Promise<THREE.Object3D> {
  const key = normalizeScenePath(path)
  const cached = assetCache.get(key)
  if (cached) return cached
  const promise = (async () => {
    const content = await client.readFile(key, 'binary')
    const loader = new GLTFLoader()
    return new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(
        content.bytes,
        '',
        (gltf) => {
          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true
              child.receiveShadow = true
            }
          })
          resolve(gltf.scene)
        },
        (error) => reject(error instanceof Error ? error : new Error(String(error))),
      )
    })
  })()
  assetCache.set(key, promise)
  promise.catch(() => {
    // A failed asset remains cached so a broken file does not retry every frame.
  })
  return promise
}

function AssetModel({
  client,
  path,
  selected,
}: {
  client: AssetReader
  path: string
  selected: boolean
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setObject(null)
    setFailed(false)
    loadAsset(client, path)
      .then((loaded) => {
        if (!cancelled) setObject(loaded.clone(true))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [client, path])

  if (object) {
    return (
      <group>
        <primitive object={object} />
        {selected && (
          <mesh>
            <boxGeometry args={[0.7, 0.7, 0.7]} />
            <meshBasicMaterial color="#59b8ff" wireframe transparent opacity={0.55} />
          </mesh>
        )}
      </group>
    )
  }
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={failed ? '#8a4f4f' : '#5d7188'}
        transparent
        opacity={failed ? 0.75 : 0.5}
        wireframe
      />
      {selected && <Outlines thickness={2.5} color="#59b8ff" />}
    </mesh>
  )
}

function Marker({
  kind,
  selected,
  muted,
  external,
}: {
  kind: string
  selected: boolean
  muted: boolean
  external: boolean
}) {
  const color = selected ? '#59b8ff' : external ? '#d1a45b' : muted ? '#596574' : '#91a2b8'
  const geometry = kind === 'camera' ? (
    <coneGeometry args={[0.14, 0.4, 4]} />
  ) : kind === 'light' ? (
    <sphereGeometry args={[0.12, 12, 8]} />
  ) : (
    <octahedronGeometry args={[0.15, 0]} />
  )
  return (
    <mesh>
      {geometry}
      <meshStandardMaterial
        color={color}
        emissive={selected ? '#1f6f9f' : '#000000'}
        transparent
        opacity={muted ? 0.45 : 0.95}
      />
      {selected && <Outlines thickness={2} color="#9fd8ff" />}
    </mesh>
  )
}

function EntityVisual({
  entity,
  document,
  context,
  selected,
  muted,
  client,
}: {
  entity: SceneEntity
  document: SceneDocument
  context: SceneValidationContext
  selected: boolean
  muted: boolean
  client: AssetReader
}) {
  if (!entity.type) return null
  const local = entity.type.split(':').at(-1) ?? ''
  const asset = assetPathFor(entity, context)
  if (asset) {
    return <AssetModel client={client} path={asset} selected={selected} />
  }
  if (local === 'directionalLight') {
    return (
      <>
        <directionalLight castShadow intensity={0.8} position={[3, 6, 3]} />
        <Marker kind="light" selected={selected} muted={muted} external={false} />
      </>
    )
  }
  if (local === 'pointLight') {
    return (
      <>
        <pointLight intensity={2} distance={10} castShadow />
        <Marker kind="light" selected={selected} muted={muted} external={false} />
      </>
    )
  }
  if (local === 'spotLight') {
    return (
      <>
        <spotLight intensity={4} angle={0.5} penumbra={0.3} distance={15} castShadow />
        <Marker kind="light" selected={selected} muted={muted} external={false} />
      </>
    )
  }
  if (local === 'camera') {
    return <Marker kind="camera" selected={selected} muted={muted} external={false} />
  }
  void document
  return <Marker kind="node" selected={selected} muted={muted} external={false} />
}

interface Attachments {
  /** Document that owns the attached host entities. */
  hostDocument: SceneDocument
  /** Document whose slot-anchor IDs receive the attachments. */
  targetDocument: SceneDocument
  byAnchor: Map<string, SceneEntity[]>
}

function EntityNode({
  entity,
  document,
  context,
  hostDocument,
  registerObject,
  selectedId,
  onSelect,
  client,
  readOnly,
  attachments,
  slotAnchors,
  depth = 0,
  injectedHostEntities,
  injectedHostDocument,
}: {
  entity: SceneEntity
  document: SceneDocument
  context: SceneValidationContext
  hostDocument: SceneDocument
  registerObject: (id: string, object: THREE.Object3D | null) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  client: AssetReader
  readOnly: boolean
  attachments?: Attachments
  slotAnchors?: Set<string>
  depth?: number
  injectedHostEntities?: SceneEntity[]
  injectedHostDocument?: SceneDocument
}) {
  if (depth > 40) return null
  const selected = !readOnly && selectedId === entity.id
  const transform = transformProps(entity.transform)
  const children = directChildren(document, entity.id).filter((child) => {
    if (entityIsSceneInstance(entity)) return !child.slot
    return child.id !== entity.id
  })
  const injected =
    attachments && attachments.targetDocument === document
      ? attachments.byAnchor.get(entity.id) ?? []
      : []
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (readOnly) return
    event.stopPropagation()
    onSelect(entity.id)
  }
  const visual = (
    <EntityVisual
      entity={entity}
      document={document}
      context={context}
      selected={selected}
      muted={readOnly}
      client={client}
    />
  )

  if (entity.scene) {
    return (
      <SceneInstanceNode
        instance={entity}
        document={document}
        context={context}
        hostDocument={hostDocument}
        registerObject={registerObject}
        selectedId={selectedId}
        onSelect={onSelect}
        client={client}
        readOnly={readOnly}
        depth={depth + 1}
        anchorAttachments={injected}
        anchorDocument={attachments?.hostDocument}
      />
    )
  }

  return (
    <group
      {...transform}
      ref={(object) => {
        if (!readOnly) registerObject(entity.id, object)
      }}
      onClick={readOnly ? undefined : handleClick}
    >
      {visual}
      {slotAnchors?.has(entity.id) && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.28, 0.025, 8, 24]} />
          <meshStandardMaterial color="#d1a45b" emissive="#6a4a14" />
        </mesh>
      )}
      {children.map((child) => (
        <EntityNode
          key={`${readOnly ? 'internal' : 'host'}-${child.id}`}
          entity={child}
          document={document}
          context={context}
          hostDocument={hostDocument}
          registerObject={registerObject}
          selectedId={selectedId}
          onSelect={onSelect}
          client={client}
          readOnly={readOnly}
          attachments={attachments}
          slotAnchors={slotAnchors}
          depth={depth + 1}
        />
      ))}
      {injected.map((child) => (
        <EntityNode
          key={`host-${child.id}`}
          entity={child}
          document={attachments!.hostDocument}
          context={context}
          hostDocument={hostDocument}
          registerObject={registerObject}
          selectedId={selectedId}
          onSelect={onSelect}
          client={client}
          readOnly={attachments!.hostDocument !== hostDocument}
          depth={depth + 1}
        />
      ))}
      {injectedHostEntities?.map((child) => (
        <EntityNode
          key={`injected-${child.id}`}
          entity={child}
          document={injectedHostDocument ?? hostDocument}
          context={context}
          hostDocument={hostDocument}
          registerObject={registerObject}
          selectedId={selectedId}
          onSelect={onSelect}
          client={client}
          readOnly={(injectedHostDocument ?? hostDocument) !== hostDocument}
          depth={depth + 1}
        />
      ))}
    </group>
  )
}

function SceneInstanceNode({
  instance,
  document,
  context,
  hostDocument,
  registerObject,
  selectedId,
  onSelect,
  client,
  readOnly,
  depth = 0,
  anchorAttachments,
  anchorDocument,
}: {
  instance: SceneEntity
  document: SceneDocument
  context: SceneValidationContext
  hostDocument: SceneDocument
  registerObject: (id: string, object: THREE.Object3D | null) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  client: AssetReader
  readOnly: boolean
  depth?: number
  anchorAttachments?: SceneEntity[]
  anchorDocument?: SceneDocument
}) {
  if (depth > 40) return null
  const selected = !readOnly && selectedId === instance.id
  const target = instance.scene ? context.scenes[normalizeScenePath(instance.scene)] : undefined
  const targetRoot = target ? entityById(target, target.root) : undefined
  const attachments = useMemo<Attachments>(() => {
    const byAnchor = new Map<string, SceneEntity[]>()
    if (!target) return { hostDocument: document, targetDocument: document, byAnchor }
    for (const child of directChildren(document, instance.id)) {
      if (!child.slot) continue
      const anchor = target.slots?.[child.slot]?.entity
      if (!anchor) continue
      byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), child])
    }
    return { hostDocument: document, targetDocument: target, byAnchor }
  }, [document, instance.id, target])
  const slotAnchors = useMemo(() => {
    const anchors = new Set<string>()
    for (const slot of Object.values(target?.slots ?? {})) anchors.add(slot.entity)
    return anchors
  }, [target])

  if (!target || !targetRoot) {
    return (
      <group
        {...transformProps(instance.transform)}
        ref={(object) => {
          if (!readOnly) registerObject(instance.id, object)
        }}
        onClick={
          readOnly
            ? undefined
            : (event) => {
                event.stopPropagation()
                onSelect(instance.id)
              }
        }
      >
        {selected && (
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color="#59b8ff" wireframe transparent opacity={0.28} />
          </mesh>
        )}
        <mesh>
          <boxGeometry args={[0.4, 0.4, 0.4]} />
          <meshStandardMaterial color="#8a4f4f" wireframe />
        </mesh>
      </group>
    )
  }
  return (
    <group
      {...transformProps(instance.transform)}
      ref={(object) => {
        if (!readOnly) registerObject(instance.id, object)
      }}
      onClick={
        readOnly
          ? undefined
          : (event) => {
              event.stopPropagation()
              onSelect(instance.id)
            }
      }
    >
      {selected && (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#59b8ff" wireframe transparent opacity={0.28} />
        </mesh>
      )}
      <EntityNode
        entity={targetRoot}
        document={target}
        context={context}
        hostDocument={hostDocument}
        registerObject={registerObject}
        selectedId={selectedId}
        onSelect={onSelect}
        client={client}
        readOnly
        attachments={attachments}
        slotAnchors={slotAnchors}
        depth={depth + 1}
        injectedHostEntities={anchorAttachments}
        injectedHostDocument={anchorDocument}
      />
    </group>
  )
}

function SceneGraph({
  scene,
  context,
  selection,
  onSelect,
  onTransform,
  mode,
  snap,
  client,
  registerObject,
  selectedObject,
  setDragging,
}: {
  scene: SceneDocument
  context: SceneValidationContext
  selection: string | null
  onSelect: (id: string | null) => void
  onTransform: (id: string, transform: EntityTransform) => void
  mode: TransformMode
  snap: boolean
  client: AssetReader
  registerObject: (id: string, object: THREE.Object3D | null) => void
  selectedObject: THREE.Object3D | null
  setDragging: (dragging: boolean) => void
}) {
  const root = entityById(scene, scene.root)
  return (
    <>
      <color attach="background" args={['#12161d']} />
      <fog attach="fog" args={['#12161d', 28, 70]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 10, 5]} intensity={1.4} castShadow />
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={5}
        cellColor="#2a3340"
        sectionColor="#3c4b5e"
        fadeDistance={45}
        fadeStrength={1.5}
        position={[0, -0.001, 0]}
      />
      {root && (
        <EntityNode
          entity={root}
          document={scene}
          context={context}
          hostDocument={scene}
          registerObject={registerObject}
          selectedId={selection}
          onSelect={onSelect}
          client={client}
          readOnly={false}
        />
      )}
      {selectedObject && (
        <TransformControls
          object={selectedObject}
          mode={mode}
          space="local"
          translationSnap={snap ? 0.25 : null}
          rotationSnap={snap ? (15 * Math.PI) / 180 : null}
          scaleSnap={snap ? 0.1 : null}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => {
            setDragging(false)
            if (!selection) return
            const position: [number, number, number] = [
              selectedObject.position.x,
              selectedObject.position.y,
              selectedObject.position.z,
            ]
            const rotation = degrees([
              selectedObject.rotation.x,
              selectedObject.rotation.y,
              selectedObject.rotation.z,
            ])
            const scale: [number, number, number] = [
              selectedObject.scale.x,
              selectedObject.scale.y,
              selectedObject.scale.z,
            ]
            onTransform(selection, { position, rotation, scale })
          }}
        />
      )}
      <GizmoHelper alignment="bottom-right" margin={[62, 62]}>
        <GizmoViewport axisColors={['#d45b5b', '#61b06a', '#4d8bd4']} labelColor="#dbe5f0" />
      </GizmoHelper>
    </>
  )
}

export function SceneViewport(props: SceneViewportProps) {
  const { scene, selection } = props
  const objects = useRef(new Map<string, THREE.Object3D>())
  const [selectedObject, setSelectedObject] = useState<THREE.Object3D | null>(null)
  const [dragging, setDragging] = useState(false)

  const registerObject = (id: string, object: THREE.Object3D | null) => {
    if (object) {
      objects.current.set(id, object)
      if (id === selection) setSelectedObject(object)
    } else {
      objects.current.delete(id)
      if (id === selection) setSelectedObject(null)
    }
  }

  useEffect(() => {
    setSelectedObject(selection ? objects.current.get(selection) ?? null : null)
  }, [selection, scene])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [7, 5.5, 7], fov: 48, near: 0.05, far: 500 }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <SceneGraph
        {...props}
        selectedObject={selectedObject}
        registerObject={registerObject}
        setDragging={setDragging}
      />
      <OrbitControls makeDefault enabled={!dragging} target={[0, 0.5, 0]} />
    </Canvas>
  )
}
