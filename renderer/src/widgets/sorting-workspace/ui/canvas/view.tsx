import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  MiniMap,
  type NodeChange,
  type EdgeChange,
  ReactFlow,
  type ReactFlowInstance,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  type Viewport,
} from '@xyflow/react';
import type {
  SortingBoxView,
  SortingCanvasEdgeView,
  SortingCanvasNodeView,
  SortingCardView,
} from '@/entities/sorting';
import '@xyflow/react/dist/style.css';
import {
  CANVAS_DEFAULT_HEIGHT,
  CANVAS_DEFAULT_VIEWPORT,
  CANVAS_DEFAULT_WIDTH,
  FLOW_FIT_VIEW_OPTIONS,
  FLOW_MULTI_SELECTION_KEYS,
  FLOW_PAN_ON_DRAG_BUTTONS,
} from '../constants';
import type {
  SortingBubbleDraft,
  SortingCanvasContextValue,
  SortingBubbleSourceInfo,
  SortingFlowEdge,
  SortingFlowNode,
} from '../types';
import {
  arrayEquals,
  buildSortingFlowEdge,
  buildSortingFlowNode,
  defaultCanvasNode,
  getSortingFlowNodeSize,
  normalizeSortingFlowEdges,
} from '../utils';
import { SORTING_FLOW_NODE_TYPES, SortingCanvasContext } from './flow-node';

export function SortingCanvasView({
  activeBox,
  items,
  boxes,
  canvasNodes,
  canvasEdges,
  sourceInfoMap,
  editingBubbleId,
  editingBubbleDraft,
  onStartEditBubble,
  onBubbleDraftChange,
  onSaveEditingBubble,
  onCancelEditingBubble,
  onOpenNodeMenu,
  onOpenCardCommentPicker,
  onOpenBox,
  onAddBubbleAt,
  onPersistNode,
  onPersistEdges,
  onResetLayout,
  onDeleteSelected,
}: {
  activeBox: SortingBoxView;
  items: SortingCardView[];
  boxes: SortingBoxView[];
  canvasNodes: SortingCanvasNodeView[];
  canvasEdges: SortingCanvasEdgeView[];
  sourceInfoMap: Record<string, SortingBubbleSourceInfo>;
  editingBubbleId: string | null;
  editingBubbleDraft: SortingBubbleDraft | null;
  onStartEditBubble: (item: SortingCardView) => void;
  onBubbleDraftChange: (patch: Partial<SortingBubbleDraft>) => void;
  onSaveEditingBubble: () => void;
  onCancelEditingBubble: () => void;
  onOpenNodeMenu: (event: MouseEvent<HTMLDivElement>, item: SortingCardView) => void;
  onOpenCardCommentPicker: (item: SortingCardView) => void;
  onOpenBox: (boxId: string) => void;
  onAddBubbleAt: (x: number, y: number) => void;
  onPersistNode: (payload: Omit<SortingCanvasNodeView, 'id'>) => void;
  onPersistEdges: (payload: Array<Pick<SortingCanvasEdgeView, 'id' | 'fromCardId' | 'toCardId' | 'label'>>) => void;
  onResetLayout: () => void;
  onDeleteSelected: (cardIds: string[]) => void;
}) {
  const reactFlowRef = useRef<ReactFlowInstance<SortingFlowNode, SortingFlowEdge> | null>(null);
  const nodesRef = useRef<SortingFlowNode[]>([]);
  const edgesRef = useRef<SortingFlowEdge[]>([]);
  const [nodes, setNodes] = useState<SortingFlowNode[]>([]);
  const [edges, setEdges] = useState<SortingFlowEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>(CANVAS_DEFAULT_VIEWPORT);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  const itemMap = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, item])),
    [items],
  );
  const cardIdSet = useMemo(
    () => new Set(items.filter((item) => item.type === 'card').map((item) => item.id)),
    [items],
  );
  const canvasContextValue = useMemo<SortingCanvasContextValue>(() => ({
    itemMap,
    boxes,
    sourceInfoMap,
    editingBubbleId,
    editingBubbleDraft,
    onStartEditBubble,
    onBubbleDraftChange,
    onSaveEditingBubble,
    onCancelEditingBubble,
    onOpenNodeMenu,
    onOpenCardCommentPicker,
    onOpenBox,
  }), [
    boxes,
    editingBubbleDraft,
    editingBubbleId,
    itemMap,
    onBubbleDraftChange,
    onCancelEditingBubble,
    onOpenCardCommentPicker,
    onOpenBox,
    onOpenNodeMenu,
    onSaveEditingBubble,
    onStartEditBubble,
    sourceInfoMap,
  ]);

  useEffect(() => {
    const previousNodes = new Map(nodesRef.current.map((node) => [node.id, node]));
    const layoutByCardId = new Map(canvasNodes.map((node) => [node.cardId, node]));
    const nextNodes = items.map((item, index) => {
      const layout = layoutByCardId.get(item.id) || defaultCanvasNode(item, index, activeBox.id);
      return buildSortingFlowNode(item, layout, previousNodes.get(item.id));
    });
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    setSelectedNodeIds((current) => current.filter((id) => nextNodes.some((node) => node.id === id)));
  }, [activeBox.id, canvasNodes, items]);

  useEffect(() => {
    const previousEdges = new Map(edgesRef.current.map((edge) => [edge.id, edge]));
    const nextEdgeViews = normalizeSortingFlowEdges(
      canvasEdges.map((edge) => ({ ...edge, boxId: activeBox.id })),
      cardIdSet,
    );
    const nextEdges = nextEdgeViews.map((edge) => buildSortingFlowEdge(edge, previousEdges.get(edge.id)));
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    setSelectedEdgeIds((current) => current.filter((id) => nextEdges.some((edge) => edge.id === id)));
  }, [activeBox.id, canvasEdges, cardIdSet]);

  useEffect(() => {
    setViewport(CANVAS_DEFAULT_VIEWPORT);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    if (reactFlowRef.current) {
      void reactFlowRef.current.setViewport(CANVAS_DEFAULT_VIEWPORT);
    }
  }, [activeBox.id]);

  const toPersistedEdgePayload = useCallback((flowEdges: SortingFlowEdge[]) => (
    flowEdges.map((edge) => ({
      id: edge.id,
      fromCardId: edge.source,
      toCardId: edge.target,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    }))
  ), []);

  const persistEdges = useCallback((draftEdges: Array<Pick<SortingCanvasEdgeView, 'id' | 'fromCardId' | 'toCardId' | 'label'>>) => {
    const previousEdges = new Map(edgesRef.current.map((edge) => [edge.id, edge]));
    const normalizedEdges = normalizeSortingFlowEdges(
      draftEdges.map((edge) => ({ ...edge, boxId: activeBox.id })),
      cardIdSet,
    );
    const nextEdges = normalizedEdges.map((edge) => buildSortingFlowEdge(edge, previousEdges.get(edge.id)));
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    setSelectedEdgeIds((current) => current.filter((id) => nextEdges.some((edge) => edge.id === id)));
    onPersistEdges(normalizedEdges.map(({ id, fromCardId, toCardId, label }) => ({ id, fromCardId, toCardId, label })));
  }, [activeBox.id, cardIdSet, onPersistEdges]);

  const handleNodesChange = useCallback((changes: NodeChange<SortingFlowNode>[]) => {
    const changedDimensions = new Map<string, { width: number; height: number }>();
    changes.forEach((change) => {
      if (change.type === 'dimensions' && change.dimensions) {
        changedDimensions.set(change.id, {
          width: change.dimensions.width || CANVAS_DEFAULT_WIDTH,
          height: change.dimensions.height || CANVAS_DEFAULT_HEIGHT,
        });
      }
    });

    let nextNodes = applyNodeChanges<SortingFlowNode>(changes, nodesRef.current);
    if (changedDimensions.size > 0) {
      nextNodes = nextNodes.map((node) => {
        const dimensions = changedDimensions.get(node.id);
        if (!dimensions) return node;
        return {
          ...node,
          width: dimensions.width,
          height: dimensions.height,
          initialWidth: dimensions.width,
          initialHeight: dimensions.height,
          style: {
            ...(node.style && typeof node.style === 'object' ? node.style : {}),
            width: dimensions.width,
            minHeight: dimensions.height,
          },
        };
      });
    }

    nodesRef.current = nextNodes;
    setNodes(nextNodes);

    const nextNodeMap = new Map(nextNodes.map((node) => [node.id, node]));
    const persistMap = new Map<string, SortingFlowNode>();
    changes.forEach((change) => {
      if (change.type === 'position' && change.position && change.dragging === false) {
        const node = nextNodeMap.get(change.id);
        if (node) persistMap.set(node.id, node);
      }
      if (change.type === 'dimensions' && change.dimensions && !change.resizing) {
        const node = nextNodeMap.get(change.id);
        if (node) persistMap.set(node.id, node);
      }
    });

    persistMap.forEach((node) => {
      const size = getSortingFlowNodeSize(node);
      void onPersistNode({
        boxId: activeBox.id,
        cardId: node.id,
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height,
        zIndex: node.zIndex || 0,
      });
    });
  }, [activeBox.id, onPersistNode]);

  const handleEdgesChange = useCallback((changes: EdgeChange<SortingFlowEdge>[]) => {
    const nextEdges = applyEdgeChanges<SortingFlowEdge>(changes, edgesRef.current);
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, []);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    persistEdges([
      ...toPersistedEdgePayload(edgesRef.current),
      {
        id: `edge_${connection.source}_${connection.target}`,
        fromCardId: connection.source,
        toCardId: connection.target,
      },
    ]);
  }, [persistEdges, toPersistedEdgePayload]);

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: SortingFlowEdge) => {
    event.stopPropagation();
    persistEdges(
      toPersistedEdgePayload(edgesRef.current).filter((candidate) => candidate.id !== edge.id),
    );
  }, [persistEdges, toPersistedEdgePayload]);

  const handleDeleteSelection = useCallback(() => {
    if (selectedNodeIds.length > 0) {
      const removedNodeIds = new Set(selectedNodeIds);
      const nextNodes = nodesRef.current.filter((node) => !removedNodeIds.has(node.id));
      const nextEdges = edgesRef.current.filter((edge) => (
        !removedNodeIds.has(edge.source)
        && !removedNodeIds.has(edge.target)
      ));
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      onDeleteSelected(selectedNodeIds);
      return;
    }

    if (selectedEdgeIds.length > 0) {
      persistEdges(
        toPersistedEdgePayload(edgesRef.current).filter((edge) => !selectedEdgeIds.includes(edge.id)),
      );
      setSelectedEdgeIds([]);
    }
  }, [onDeleteSelected, persistEdges, selectedEdgeIds, selectedNodeIds, toPersistedEdgePayload]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      event.preventDefault();
      handleDeleteSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleDeleteSelection, selectedEdgeIds.length, selectedNodeIds.length]);

  const handleFitView = useCallback(() => {
    if (!reactFlowRef.current) return;
    if (nodesRef.current.length === 0) {
      void reactFlowRef.current.setViewport(CANVAS_DEFAULT_VIEWPORT, { duration: 160 });
      return;
    }
    void reactFlowRef.current.fitView({ padding: 0.18, duration: 180 });
  }, []);

  const handleResetViewport = useCallback(() => {
    if (!reactFlowRef.current) return;
    void reactFlowRef.current.setViewport(CANVAS_DEFAULT_VIEWPORT, { duration: 160 });
  }, []);

  const handleFlowInit = useCallback((instance: ReactFlowInstance<SortingFlowNode, SortingFlowEdge>) => {
    reactFlowRef.current = instance;
  }, []);

  const handleViewportChange = useCallback((nextViewport: Viewport) => {
    setViewport((current) => {
      if (
        current.x === nextViewport.x
        && current.y === nextViewport.y
        && current.zoom === nextViewport.zoom
      ) {
        return current;
      }
      return nextViewport;
    });
  }, []);

  const handleSelectionChange = useCallback((
    payload: { nodes: SortingFlowNode[]; edges: SortingFlowEdge[] },
  ) => {
    const nextNodeIds = payload.nodes.map((node) => node.id);
    const nextEdgeIds = payload.edges.map((edge) => edge.id);
    setSelectedNodeIds((current) => (arrayEquals(current, nextNodeIds) ? current : nextNodeIds));
    setSelectedEdgeIds((current) => (arrayEquals(current, nextEdgeIds) ? current : nextEdgeIds));
  }, []);

  const isValidConnection = useCallback((edgeOrConnection: SortingFlowEdge | Connection) => {
    const source = edgeOrConnection.source;
    const target = edgeOrConnection.target;
    if (!source || !target || source === target) return false;
    if (!cardIdSet.has(source) || !cardIdSet.has(target)) return false;
    return !edgesRef.current.some((edge) => edge.source === source && edge.target === target);
  }, [cardIdSet]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] px-4 py-3">
        <div className="text-xs text-[var(--text-secondary)]">
          双击空白创建泡泡，空格拖拽平移，框选可多选，拖拽节点圆点可连线
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-black/10 px-2 py-1 text-xs text-[var(--text-secondary)]"
            onClick={() => {
              if (!reactFlowRef.current) return;
              void reactFlowRef.current.zoomOut({ duration: 120 });
            }}
          >
            -
          </button>
          <span className="w-12 text-center text-xs text-[var(--text-secondary)]">{Math.round(viewport.zoom * 100)}%</span>
          <button
            type="button"
            className="rounded-full border border-black/10 px-2 py-1 text-xs text-[var(--text-secondary)]"
            onClick={() => {
              if (!reactFlowRef.current) return;
              void reactFlowRef.current.zoomIn({ duration: 120 });
            }}
          >
            +
          </button>
          <button type="button" className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]" onClick={handleFitView}>适配视图</button>
          <button type="button" className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]" onClick={handleResetViewport}>重置视角</button>
          <button type="button" className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]" onClick={onResetLayout}>重置布局</button>
        </div>
      </div>

      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden"
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (!target?.closest('.react-flow__pane')) return;
          const position = reactFlowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          if (!position) return;
          onAddBubbleAt(position.x, position.y);
        }}
      >
        <SortingCanvasContext.Provider value={canvasContextValue}>
          <ReactFlow<SortingFlowNode, SortingFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={SORTING_FLOW_NODE_TYPES}
            defaultViewport={CANVAS_DEFAULT_VIEWPORT}
            attributionPosition="bottom-left"
            minZoom={0.35}
            maxZoom={2.2}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={FLOW_MULTI_SELECTION_KEYS}
            panActivationKeyCode="Space"
            panOnDrag={FLOW_PAN_ON_DRAG_BUTTONS}
            deleteKeyCode={null}
            edgesReconnectable={false}
            zoomOnDoubleClick={false}
            connectionMode={ConnectionMode.Strict}
            noDragClassName="nodrag"
            noPanClassName="nopan"
            noWheelClassName="nowheel"
            onInit={handleFlowInit}
            onViewportChange={handleViewportChange}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onEdgeClick={handleEdgeClick}
            onSelectionChange={handleSelectionChange}
            isValidConnection={isValidConnection}
            fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
            className="bg-[#f6f7f2]"
          >
            <Background id={`sorting-bg-${activeBox.id}`} variant={BackgroundVariant.Lines} gap={32} color="rgba(0,0,0,0.06)" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeStrokeWidth={2}
              nodeColor={(node) => node.data.itemType === 'box' ? '#d0c5b7' : '#8db09c'}
              maskColor="rgba(255,255,255,0.72)"
              style={{
                width: 176,
                height: 112,
                borderRadius: 14,
                border: '1px solid rgba(0,0,0,0.1)',
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
              }}
              className="!bottom-3 !right-3 !h-28 !w-44 !rounded-[14px] !border !border-black/10 !bg-white/90 !p-1.5 !shadow-sm"
            />
          </ReactFlow>
        </SortingCanvasContext.Provider>

        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-[24px] border border-dashed border-black/10 bg-white/86 px-6 py-5 text-center text-sm text-[var(--text-secondary)] shadow-sm">
              <p className="mb-1 font-semibold text-[var(--text-primary)]">双击空白处添加泡泡</p>
              <span>当前箱体还没有可视化泡泡</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
