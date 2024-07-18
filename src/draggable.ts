export function makeDraggable(
  element: HTMLElement | null,
  onDrag: (dx: number, dy: number, x: number, y: number, element: HTMLElement | null) => void,
  onStart?: (x: number, y: number) => void,
  onEnd?: (x: number, y: number) => void,
  threshold = 3,
  mouseButton = 0,
  touchDelay = 100,
  side: string | null = null,
): () => void {
  if (!element) return () => void 0

  const isTouchDevice = matchMedia('(pointer: coarse)').matches

  let unsubscribeDocument = () => void 0

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== mouseButton) return

    event.preventDefault()
    event.stopPropagation()

    let startX = event.clientX
    let startY = event.clientY
    let isDragging = false
    const touchStartTime = Date.now()

    let startXFromRectLeft = 0
    if (!side) {
      const periodRectLeft = element.getBoundingClientRect().left
      startXFromRectLeft = event.clientX - periodRectLeft
    }

    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (isTouchDevice && Date.now() - touchStartTime < touchDelay) return

      const x = event.clientX
      const y = event.clientY
      const dx = x - startX
      const dy = y - startY

      if (isDragging || Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        const rect = element.getBoundingClientRect()
        const { left, top, right } = rect

        if (!isDragging) {
          onStart?.(startX - left, startY - top)
          isDragging = true
        }

        let leaveEarlier = false
        if ( side === 'start'
          && ( (dx > 0 && x < left) || (dx < 0 && x > right) )
        ) {
          leaveEarlier = true
        }
        else if (side === 'end' && ( (dx > 0 && x < left) || (dx < 0 && x > right) )) {
          leaveEarlier = true
        }
        else if (!side) {
          const currentStartXFromRectLeft = event.clientX - left
          if ((dx > 0 && currentStartXFromRectLeft < startXFromRectLeft) || (dx < 0 && currentStartXFromRectLeft > startXFromRectLeft)) {
            leaveEarlier = true
          }
        }
        if (leaveEarlier) {
          startX = x
          startY = y
          return
        }

        onDrag(dx, dy, x - left, y - top, element)

        startX = x
        startY = y
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (isDragging) {
        const x = event.clientX
        const y = event.clientY
        const rect = element.getBoundingClientRect()
        const { left, top } = rect

        onEnd?.(x - left, y - top)
      }
      unsubscribeDocument()
    }

    const onPointerLeave = (e: PointerEvent) => {
      // Listen to events only on the document and not on inner elements
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        onPointerUp(e)
      }
    }

    const onClick = (event: MouseEvent) => {
      if (isDragging) {
        event.stopPropagation()
        event.preventDefault()
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (isDragging) {
        event.preventDefault()
      }
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointerout', onPointerLeave)
    document.addEventListener('pointercancel', onPointerLeave)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('click', onClick, { capture: true })

    unsubscribeDocument = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointerout', onPointerLeave)
      document.removeEventListener('pointercancel', onPointerLeave)
      document.removeEventListener('touchmove', onTouchMove)
      setTimeout(() => {
        document.removeEventListener('click', onClick, { capture: true })
      }, 10)
    }
  }

  element.addEventListener('pointerdown', onPointerDown)

  return () => {
    unsubscribeDocument()
    element.removeEventListener('pointerdown', onPointerDown)
  }
}
