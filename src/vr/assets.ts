export const VR_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeGraph Spatial Viewer</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="scene" aria-label="CodeGraph VR graph"></canvas>
  <div id="hud">
    <strong>CodeGraph Spatial Viewer</strong>
    <span id="stats">Loading graph...</span>
    <button id="vrButton" disabled>Enter VR</button>
    <button id="arButton" disabled>Enter AR</button>
  </div>
  <div id="toast"></div>
  <script src="client.js"></script>
</body>
</html>
`;

export const VR_CSS = `
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #101418;
  color: #eef4f8;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#scene {
  width: 100vw;
  height: 100vh;
  display: block;
  touch-action: none;
}

#hud {
  position: fixed;
  left: 16px;
  top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(238, 244, 248, 0.16);
  background: rgba(16, 20, 24, 0.78);
  backdrop-filter: blur(12px);
  border-radius: 8px;
  font-size: 14px;
}

#stats {
  color: #aac2cf;
}

#vrButton,
#arButton {
  border: 1px solid rgba(238, 244, 248, 0.22);
  color: #101418;
  background: #8fe0b0;
  border-radius: 6px;
  font: inherit;
  font-weight: 650;
  padding: 7px 10px;
}

#vrButton:disabled,
#arButton:disabled {
  color: #73818a;
  background: #26313a;
}

#toast {
  position: fixed;
  left: 16px;
  bottom: 16px;
  max-width: min(520px, calc(100vw - 32px));
  color: #dbe8ee;
  background: rgba(16, 20, 24, 0.82);
  border: 1px solid rgba(238, 244, 248, 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.4;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 160ms ease, transform 160ms ease;
}

#toast.visible {
  opacity: 1;
  transform: translateY(0);
}
`;

export const VR_CLIENT_JS = `
(function () {
  'use strict';

  var canvas = document.getElementById('scene');
  var statsEl = document.getElementById('stats');
  var vrButton = document.getElementById('vrButton');
  var arButton = document.getElementById('arButton');
  var toast = document.getElementById('toast');
  var gl = canvas.getContext('webgl', { antialias: true, alpha: true, xrCompatible: true });
  var graph = null;
  var nodeBuffer = null;
  var nodeColorBuffer = null;
  var nodeSizeBuffer = null;
  var edgeBuffer = null;
  var edgeColorBuffer = null;
  var program = null;
  var attribs = {};
  var uniforms = {};
  var nodeCount = 0;
  var edgeVertexCount = 0;
  var rotationX = -0.28;
  var rotationY = 0.42;
  var zoom = 4.2;
  var dragging = false;
  var lastX = 0;
  var lastY = 0;
  var xrSession = null;
  var xrRefSpace = null;
  var xrMode = null;

  if (!gl) {
    statsEl.textContent = 'WebGL is unavailable in this browser.';
    return;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.classList.remove('visible');
    }, 5200);
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function compileShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
    }
    return shader;
  }

  function initProgram() {
    var vertex = compileShader(gl.VERTEX_SHADER, [
      'attribute vec3 aPosition;',
      'attribute vec3 aColor;',
      'attribute float aSize;',
      'uniform mat4 uMatrix;',
      'uniform float uPointMode;',
      'varying vec3 vColor;',
      'void main() {',
      '  vColor = aColor;',
      '  gl_Position = uMatrix * vec4(aPosition, 1.0);',
      '  gl_PointSize = aSize;',
      '}'
    ].join('\\n'));
    var fragment = compileShader(gl.FRAGMENT_SHADER, [
      'precision mediump float;',
      'uniform float uPointMode;',
      'varying vec3 vColor;',
      'void main() {',
      '  if (uPointMode > 0.5) {',
      '    vec2 p = gl_PointCoord - vec2(0.5);',
      '    if (dot(p, p) > 0.25) discard;',
      '  }',
      '  gl_FragColor = vec4(vColor, uPointMode > 0.5 ? 0.95 : 0.42);',
      '}'
    ].join('\\n'));
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    }
    attribs.position = gl.getAttribLocation(program, 'aPosition');
    attribs.color = gl.getAttribLocation(program, 'aColor');
    attribs.size = gl.getAttribLocation(program, 'aSize');
    uniforms.matrix = gl.getUniformLocation(program, 'uMatrix');
    uniforms.pointMode = gl.getUniformLocation(program, 'uPointMode');
  }

  function bufferData(target, data) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  }

  function buildBuffers() {
    var nodePositions = [];
    var nodeColors = [];
    var nodeSizes = [];
    var nodeById = new Map();
    graph.nodes.forEach(function (node) {
      nodeById.set(node.id, node);
      nodePositions.push(node.position[0], node.position[1], node.position[2]);
      nodeColors.push(node.color[0], node.color[1], node.color[2]);
      nodeSizes.push(Math.max(4, Math.min(18, 4 + node.weight * 3)));
    });
    var edgePositions = [];
    var edgeColors = [];
    graph.edges.forEach(function (edge) {
      var source = nodeById.get(edge.source);
      var target = nodeById.get(edge.target);
      if (!source || !target) return;
      edgePositions.push(source.position[0], source.position[1], source.position[2]);
      edgePositions.push(target.position[0], target.position[1], target.position[2]);
      edgeColors.push(edge.color[0], edge.color[1], edge.color[2]);
      edgeColors.push(edge.color[0], edge.color[1], edge.color[2]);
    });
    nodeCount = graph.nodes.length;
    edgeVertexCount = edgePositions.length / 3;
    nodeBuffer = bufferData(gl.ARRAY_BUFFER, new Float32Array(nodePositions));
    nodeColorBuffer = bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeColors));
    nodeSizeBuffer = bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeSizes));
    edgeBuffer = bufferData(gl.ARRAY_BUFFER, new Float32Array(edgePositions));
    edgeColorBuffer = bufferData(gl.ARRAY_BUFFER, new Float32Array(edgeColors));
  }

  function bindVec3(buffer, location) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  }

  function bindFloat(buffer, location) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
  }

  function draw(matrix) {
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.matrix, false, matrix);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    bindVec3(edgeBuffer, attribs.position);
    bindVec3(edgeColorBuffer, attribs.color);
    gl.disableVertexAttribArray(attribs.size);
    gl.vertexAttrib1f(attribs.size, 1);
    gl.uniform1f(uniforms.pointMode, 0);
    gl.lineWidth(1);
    gl.drawArrays(gl.LINES, 0, edgeVertexCount);

    bindVec3(nodeBuffer, attribs.position);
    bindVec3(nodeColorBuffer, attribs.color);
    bindFloat(nodeSizeBuffer, attribs.size);
    gl.uniform1f(uniforms.pointMode, 1);
    gl.drawArrays(gl.POINTS, 0, nodeCount);
  }

  function renderDesktop() {
    if (xrSession) return;
    resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.063, 0.078, 0.094, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = canvas.width / canvas.height;
    var matrix = multiply(
      perspective(60 * Math.PI / 180, aspect, 0.05, 100),
      multiply(translate(0, 0, -zoom), multiply(rotateX(rotationX), rotateY(rotationY)))
    );
    draw(matrix);
    window.requestAnimationFrame(renderDesktop);
  }

  function renderXR(time, frame) {
    xrSession.requestAnimationFrame(renderXR);
    var pose = frame.getViewerPose(xrRefSpace);
    if (!pose) return;
    var layer = xrSession.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    var transparent = xrMode === 'immersive-ar';
    gl.clearColor(transparent ? 0 : 0.063, transparent ? 0 : 0.078, transparent ? 0 : 0.094, transparent ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var distance = transparent ? -1.45 : -3.2;
    var height = transparent ? 0 : 1.35;
    var model = multiply(translate(0, height, distance), multiply(rotateX(-0.18), rotateY(Date.now() * 0.00008)));
    pose.views.forEach(function (view) {
      var viewport = layer.getViewport(view);
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      var matrix = multiply(view.projectionMatrix, multiply(view.transform.inverse.matrix, model));
      draw(matrix);
    });
  }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    var nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0
    ]);
  }

  function translate(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
    ]);
  }

  function rotateX(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1
    ]);
  }

  function rotateY(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ]);
  }

  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var row = 0; row < 4; row += 1) {
      for (var col = 0; col < 4; col += 1) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function wireInput() {
    canvas.addEventListener('pointerdown', function (event) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dx = event.clientX - lastX;
      var dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      rotationY += dx * 0.006;
      rotationX += dy * 0.006;
      rotationX = Math.max(-1.35, Math.min(1.35, rotationX));
    });
    canvas.addEventListener('pointerup', function (event) {
      dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoom = Math.max(1.7, Math.min(10, zoom + event.deltaY * 0.004));
    }, { passive: false });
  }

  async function setupXR() {
    if (!navigator.xr || !window.isSecureContext) {
      showToast('WebXR needs a secure context. Desktop view is available here; localhost works through Virtual Desktop, and public Pages is HTTPS.');
      return;
    }
    var supportedAny = false;
    try {
      var vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
      if (vrSupported) {
        supportedAny = true;
        vrButton.disabled = false;
        vrButton.addEventListener('click', function () { enterXR('immersive-vr'); });
      }
    } catch (err) {
      showToast('VR support check failed: ' + (err && err.message ? err.message : String(err)));
    }
    try {
      var arSupported = await navigator.xr.isSessionSupported('immersive-ar');
      if (arSupported) {
        supportedAny = true;
        arButton.disabled = false;
        arButton.addEventListener('click', function () { enterXR('immersive-ar'); });
      }
    } catch (err) {
      showToast('AR support check failed: ' + (err && err.message ? err.message : String(err)));
    }
    if (!supportedAny) showToast('This browser did not report immersive VR or AR support. Desktop view is still available.');
  }

  async function enterXR(mode) {
    if (xrSession) return;
    try {
      var sessionOptions = mode === 'immersive-vr'
        ? { optionalFeatures: ['local-floor', 'bounded-floor'] }
        : { requiredFeatures: ['local'], optionalFeatures: ['dom-overlay'], domOverlay: { root: document.body } };
      xrSession = await navigator.xr.requestSession(mode, sessionOptions);
      xrMode = mode;
      await gl.makeXRCompatible();
      xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl, { alpha: mode === 'immersive-ar' }) });
      xrRefSpace = mode === 'immersive-vr'
        ? await xrSession.requestReferenceSpace('local-floor').catch(function () { return xrSession.requestReferenceSpace('local'); })
        : await xrSession.requestReferenceSpace('local');
      xrSession.addEventListener('end', function () {
        xrSession = null;
        xrRefSpace = null;
        xrMode = null;
        window.requestAnimationFrame(renderDesktop);
      });
      xrSession.requestAnimationFrame(renderXR);
    } catch (err) {
      xrSession = null;
      xrRefSpace = null;
      xrMode = null;
      showToast('Could not enter ' + (mode === 'immersive-ar' ? 'AR' : 'VR') + ': ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function boot() {
    try {
      initProgram();
      wireInput();
      var response = await fetch('graph.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('graph.json returned ' + response.status);
      graph = await response.json();
      buildBuffers();
      var git = graph.git4d && graph.git4d.loaded ? ', git4d linked: ' + graph.git4d.bridgeCount : ', git4d: none';
      statsEl.textContent = graph.nodes.length + ' nodes, ' + graph.edges.length + ' edges' + git;
      await setupXR();
      window.addEventListener('resize', resize);
      window.requestAnimationFrame(renderDesktop);
    } catch (err) {
      statsEl.textContent = 'Failed to load graph.';
      showToast(err && err.message ? err.message : String(err));
    }
  }

  boot();
}());
`;
