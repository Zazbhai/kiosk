import { useEffect, useRef } from 'react'
import { Renderer, Camera, Geometry, Program, Mesh } from 'ogl'

export default function ParticleBackground() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = containerRef.current
    if (!box) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const P = {
      count: 480,
      spread: 10,
      speed: 0.1,
      size: 120,
      rand: 1,
      cam: 20,
      hover: 1.2,
      colors: ['#e5383b', '#ff5c5f', '#ff9b9d', '#c92a2d'],
      rot: prefersReducedMotion,
    }

    const hex = (h: string) => {
      const clean = h.replace('#', '')
      const n = parseInt(clean, 16)
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    }

    const vs = `attribute vec3 position;attribute vec4 random;attribute vec3 color;uniform mat4 modelMatrix;uniform mat4 viewMatrix;uniform mat4 projectionMatrix;uniform float uTime;uniform float uSpread;uniform float uBaseSize;uniform float uSizeRandomness;varying vec4 vRandom;varying vec3 vColor;
void main(){vRandom=random;vColor=color;vec3 pos=position*uSpread;pos.z*=10.0;vec4 mPos=modelMatrix*vec4(pos,1.0);float t=uTime;
mPos.x+=sin(t*random.z+6.28*random.w)*mix(0.1,1.5,random.x);mPos.y+=sin(t*random.y+6.28*random.x)*mix(0.1,1.5,random.w);mPos.z+=sin(t*random.w+6.28*random.y)*mix(0.1,1.5,random.z);
vec4 mvPos=viewMatrix*mPos;gl_PointSize=(uBaseSize*(1.0+uSizeRandomness*(random.x-0.5)))/length(mvPos.xyz);gl_Position=projectionMatrix*mvPos;}`

    const fs = `precision highp float;uniform float uTime;varying vec4 vRandom;varying vec3 vColor;
void main(){vec2 uv=gl_PointCoord.xy;float d=length(uv-vec2(0.5));float c=smoothstep(0.5,0.1,d)*0.75;gl_FragColor=vec4(vColor+0.12*sin(uv.yxx+uTime+vRandom.y*6.28),c);}`

    let renderer: any = null
    let animId = 0

    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        depth: false,
        alpha: true,
      })
      const gl = renderer.gl
      box.appendChild(gl.canvas)
      gl.clearColor(0, 0, 0, 0)

      const cam = new Camera(gl, { fov: 15 })
      cam.position.set(0, 0, P.cam)

      const handleResize = () => {
        if (!box) return
        renderer.setSize(box.clientWidth || window.innerWidth, box.clientHeight || window.innerHeight)
        cam.perspective({ aspect: gl.canvas.width / gl.canvas.height })
      }
      window.addEventListener('resize', handleResize)
      handleResize()

      const pos = new Float32Array(P.count * 3)
      const rnd = new Float32Array(P.count * 4)
      const col = new Float32Array(P.count * 3)

      for (let i = 0; i < P.count; i++) {
        let x = 0, y = 0, z = 0, l = 0
        do {
          x = Math.random() * 2 - 1
          y = Math.random() * 2 - 1
          z = Math.random() * 2 - 1
          l = x * x + y * y + z * z
        } while (l > 1 || !l)
        const k = Math.cbrt(Math.random())

        pos.set([x * k, y * k, z * k], i * 3)
        rnd.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
        col.set(hex(P.colors[(Math.random() * P.colors.length) | 0]), i * 3)
      }

      const geo = new Geometry(gl, {
        position: { size: 3, data: pos },
        random: { size: 4, data: rnd },
        color: { size: 3, data: col },
      })

      const prog = new Program(gl, {
        vertex: vs,
        fragment: fs,
        uniforms: {
          uTime: { value: 0 },
          uSpread: { value: P.spread },
          uBaseSize: { value: P.size * Math.min(window.devicePixelRatio || 1, 2) },
          uSizeRandomness: { value: P.rand },
        },
        transparent: true,
        depthTest: false,
      })

      const m = new Mesh(gl, { mode: gl.POINTS, geometry: geo, program: prog })

      const ms = { x: 0, y: 0 }
      const handlePointerMove = (e: PointerEvent) => {
        ms.x = (e.clientX / window.innerWidth) * 2 - 1
        ms.y = -((e.clientY / window.innerHeight) * 2 - 1)
      }
      window.addEventListener('pointermove', handlePointerMove)

      let last = performance.now()
      let el = 0

      const updateLoop = (t: number) => {
        animId = requestAnimationFrame(updateLoop)
        el += (t - last) * P.speed
        last = t
        prog.uniforms.uTime.value = el * 0.001

        m.position.x += (-ms.x * P.hover - m.position.x) * 0.05
        m.position.y += (-ms.y * P.hover - m.position.y) * 0.05

        if (!P.rot) {
          m.rotation.x = Math.sin(el * 0.0002) * 0.1
          m.rotation.y = Math.cos(el * 0.0005) * 0.15
          m.rotation.z += 0.01 * P.speed
        }
        renderer.render({ scene: m, camera: cam })
      }
      animId = requestAnimationFrame(updateLoop)

      return () => {
        cancelAnimationFrame(animId)
        window.removeEventListener('resize', handleResize)
        window.removeEventListener('pointermove', handlePointerMove)
        if (gl.canvas && gl.canvas.parentElement) {
          gl.canvas.parentElement.removeChild(gl.canvas)
        }
      }
    } catch (e) {
      console.warn('Particle background disabled / WebGL unsupported', e)
    }
  }, [])

  return <div id="bg" ref={containerRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
}
