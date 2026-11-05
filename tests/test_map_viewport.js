const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../templates/index.html'),'utf8');
const code=['renderMapView','rememberMapViewport','clearMap','renderMap']
    .map(name=>source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
const nodes=[{node_num:7,node_id:'!00000007',short_name:'A',long_name:'Alder',latitude:45,longitude:-122},
    {node_num:8,node_id:'!00000008',short_name:'B',long_name:'Birch',latitude:46,longitude:-123}];
function fixture(){
    const frames=[],maps=[],markers=[],layers=[];
    let element={},writes=0;
    const status={classList:{add(){},remove(){}}};
    const container={querySelector:()=>element,set innerHTML(value){writes++;element={};}};
    const c={currentProfile:{id:'p'},activeChatTab:'map',meshNodes:nodes.map(n=>({...n})),
        mapInstance:null,mapLayerGroup:null,mapOwnerProfileId:null,mapRenderRevision:0,mapViewports:new Map(),mapNodeMarkers:new Map(),
        document:{getElementById:id=>id==='nodeMap'?element:status},
        window:{requestAnimationFrame:callback=>frames.push(callback)},
        hasRenderableLocation:node=>node.latitude!==null && node.longitude!==null,
        escapeHtml:String,getNodeMarkerColors:()=>({background:'#123456',foreground:'#ffffff'}),
        createNodeMapPopup:node=>node.long_name,
        buildMapBaseLayers:()=>Object.fromEntries(['OpenStreetMap','Dark'].map(name=>[name,{addTo(map){layers.push(name);}}])),
        L:{
            map(el){
                const map={element:el,center:{lat:0,lng:0},zoom:0,events:{},fits:0,views:0,removed:false,
                    getContainer(){return this.element;},getCenter(){return this.center;},getZoom(){return this.zoom;},
                    on(name,callback){this.events[name]=callback;},
                    setView(center,zoom){this.center={lat:center[0],lng:center[1]};this.zoom=zoom;this.views++;this.events.moveend?.();},
                    fitBounds(bounds){this.fits++;this.setView(bounds[0],6);},remove(){this.removed=true;},invalidateSize(){},
                };maps.push(map);return map;
            },
            control:{layers:()=>({addTo(){}})},
            layerGroup:()=>({members:new Set(),addTo(){return this;},removeLayer(marker){this.members.delete(marker);}}),
            divIcon:options=>options,
            marker(position,options){
                const marker={position,options,moves:0,icons:0,popupOpen:false,
                    bindPopup(callback){this.popup=callback;},addTo(group){group.members.add(this);},
                    setLatLng(next){this.moves++;this.position=next;},setIcon(icon){this.icons++;this.options.icon=icon;},
                    isPopupOpen(){return this.popupOpen;},setPopupContent(callback){this.popup=callback;}};
                markers.push(marker);return marker;
            },
        },
    };
    vm.createContext(c);vm.runInContext(code,c);
    const flush=()=>{while(frames.length)frames.shift()();};
    return {c,container,frames,flush,maps,markers,layers,get writes(){return writes;}};
}
test('packet-driven renders update markers without rebuilding or refitting a zoomed map',()=>{
    const f=fixture();f.c.renderMapView(f.container);f.flush();
    const map=f.maps[0];map.setView([45.5,-122.5],15);
    f.c.meshNodes[0]={...f.c.meshNodes[0],latitude:45.1};
    f.c.renderMapView(f.container);f.flush();
    assert.equal(f.maps.length,1);assert.equal(f.writes,0);
    assert.equal(map.fits,1);assert.equal(map.zoom,15);
    assert.deepEqual(map.center,{lat:45.5,lng:-122.5});
    assert.equal(f.markers.length,2);assert.equal(f.markers[0].moves,1);
    assert.equal(map.removed,false);
});
test('leaving and reopening the map restores center, zoom and chosen base layer',()=>{
    const f=fixture();f.c.renderMap(f.c.meshNodes);f.flush();
    f.maps[0].setView([44,-121],14);f.maps[0].events.baselayerchange({name:'Dark'});
    f.c.clearMap();f.c.renderMap(f.c.meshNodes);f.flush();
    assert.equal(f.maps.length,2);assert.equal(f.maps[1].fits,0);
    assert.deepEqual(f.maps[1].center,{lat:44,lng:-121});assert.equal(f.maps[1].zoom,14);
    assert.deepEqual(f.layers,['OpenStreetMap','Dark']);
});
test('profile map viewports are independent',()=>{
    const f=fixture();f.c.renderMap(f.c.meshNodes);f.maps[0].setView([40,-120],16);
    f.c.currentProfile={id:'other'};f.c.renderMap(f.c.meshNodes);
    assert.equal(f.maps[1].fits,1);f.maps[1].setView([47,-123],11);
    f.c.currentProfile={id:'p'};f.c.renderMap(f.c.meshNodes);
    assert.equal(f.maps[2].fits,0);assert.equal(f.maps[2].zoom,16);
    assert.deepEqual(f.maps[2].center,{lat:40,lng:-120});
});
test('new far-away nodes and an empty marker update never reset the viewport',()=>{
    const f=fixture();f.c.renderMap(f.c.meshNodes);const map=f.maps[0];map.setView([45,-122],17);
    f.c.renderMap([...f.c.meshNodes,{...nodes[0],node_num:9,latitude:-30,longitude:120}]);
    assert.equal(map.fits,1);assert.equal(map.zoom,17);
    f.c.meshNodes=[];f.c.renderMapView(f.container);f.flush();
    assert.equal(f.c.mapNodeMarkers.size,0);assert.equal(f.c.mapLayerGroup.members.size,0);
    assert.equal(f.maps.length,1);assert.equal(map.zoom,17);assert.equal(map.removed,false);
});
test('updates queued before leaving the map do not recreate it after navigation',()=>{
    const f=fixture();f.c.renderMapView(f.container);f.c.activeChatTab='channel';f.c.clearMap();f.flush();
    assert.equal(f.maps.length,0);
});
test('unchanged updates preserve open popups and icon objects',()=>{
    const f=fixture();f.c.renderMap(f.c.meshNodes);f.markers[0].popupOpen=true;
    f.c.renderMap(f.c.meshNodes);
    assert.equal(f.markers[0].icons,0);assert.equal(f.markers[0].popupOpen,true);
    f.c.meshNodes[0]={...f.c.meshNodes[0],long_name:'New name'};f.c.renderMap(f.c.meshNodes);
    assert.equal(f.markers[0].popup(),'New name');assert.equal(f.markers[0].icons,1);
});
