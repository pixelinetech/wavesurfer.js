/**
 * Regions are visual overlays on the waveform that can be used to mark segments of audio.
 * Regions can be clicked on, dragged and resized.
 * You can set the color and content of each region, as well as their HTML content.
 */

import BasePlugin, { type BasePluginEvents } from '../base-plugin.js'
import { makeDraggable } from '../draggable.js'
import EventEmitter from '../event-emitter.js'
import createElement from '../dom.js'

export type RegionsPluginOptions = undefined

export type RegionsPluginEvents = BasePluginEvents & {
  'region-created': [region: Region]
  'region-updated': [region: Region]
  'region-removed': [region: Region]
  'region-clicked': [region: Region, e: MouseEvent]
  'region-mouseup': [region: Region, e: MouseEvent]
  'region-double-clicked': [region: Region, e: MouseEvent]
  'region-in': [region: Region]
  'region-out': [region: Region] | null
}

export type RegionEvents = {
  /** Before the region is removed */
  remove: []
  /** When the region's parameters are being updated */
  update: [side?: 'start' | 'end' | null, element?: HTMLElement | null, dx?: number]
  /** When dragging or resizing is finished */
  'update-end': []
  /** On play */
  play: []
  /** On mouse click */
  click: [event: MouseEvent]
  /** On mouseup */
  mouseup: [event: MouseEvent]
  /** Double click */
  dblclick: [event: MouseEvent]
  /** Mouse over */
  over: [event: MouseEvent]
  /** Mouse leave */
  leave: [event: MouseEvent]
}

export type RegionParams = {
  /** The id of the region, any string */
  id?: string
  /** The start position of the region (in seconds) */
  start: number
  /** The end position of the region (in seconds) */
  end?: number
  /** Allow/dissallow dragging the region */
  drag?: boolean
  /** Allow/dissallow resizing the region */
  resize?: boolean
  /** The color of the region (CSS color) */
  color?: string
  /** Content string or HTML element */
  content?: string | HTMLElement
  /** Min length when resizing (in seconds) */
  minLength?: number
  /** Max length when resizing (in seconds) */
  maxLength?: number
  /** The index of the channel */
  channelIdx?: number
  /** Allow/Disallow contenteditable property for content */
  contentEditable?: boolean
}

class Region extends EventEmitter<RegionEvents> {
  public element: HTMLElement
  public id: string
  public start: number
  public end: number
  public drag: boolean
  public resize: boolean
  public color: string
  public content?: HTMLElement
  public minLength = 0
  public maxLength = Infinity
  public channelIdx: number
  public contentEditable = false
  public subscriptions: (() => void)[] = []
  public regionsList: { start: number, end: number, content: string, color: string, drag: boolean, resize: boolean, }[] = []
  public regionsListIndex: number
  public divForDuration?: HTMLElement

  public startPercentPosition: number
  public endPercentPosition: number

  private runScrollAdjuster_Interval: NodeJS.Timeout

  constructor(params: RegionParams, private totalDuration: number, private numberOfChannels = 0) {
    super()

    this.subscriptions = []
    this.id = params.id || `region-${Math.random().toString(32).slice(2)}`
    this.start = this.clampPosition(params.start)
    this.end = this.clampPosition(params.end ?? params.start)
    this.drag = params.drag ?? true
    this.resize = params.resize ?? true
    this.color = params.color ?? 'rgba(0, 0, 0, 0.1)'
    this.minLength = params.minLength ?? this.minLength
    this.maxLength = params.maxLength ?? this.maxLength
    this.channelIdx = params.channelIdx ?? -1
    this.contentEditable = params.contentEditable ?? this.contentEditable
    this.element = this.initElement()

    this.startPercentPosition = (this.start / this.totalDuration) * 100
    this.endPercentPosition = 100 - (((this.totalDuration - this.end) / this.totalDuration) * 100)


    this.regionsListIndex = 0

    this.divForDuration = this.setDivForDuration()

    this.runScrollAdjuster_Interval = setTimeout(()=>{},0)

    document.addEventListener('mouseup', (e)=>{
      this.documentMouseUpRegionsListener(e)
    })

    this.setContent(params.content)
    this.setPart()



    this.renderPosition()
    this.initMouseEvents()
  }

  public documentMouseUpRegionsListener(event: MouseEvent) {
    console.log('documentMouseUpRegionsListener', event.target)
    this.stopRunScrollAdjuster()
  }

  private clampPosition(time: number): number {
    return Math.max(0, Math.min(this.totalDuration, time))
  }

  private setPart() {
    const isMarker = this.start === this.end
    this.element.setAttribute('part', `${isMarker ? 'marker' : 'region'} ${this.id}`)
  }

  private addResizeHandles(element: HTMLElement) {
    const handleStyle = {
      position: 'absolute',
      zIndex: '2',
      width: '13px',
      height: 'calc(100% + 4px)',
      top: '-2px',
      cursor: 'ew-resize',
      wordBreak: 'keep-all',
    }

    const leftHandle = createElement(
      'div',
      {
        part: 'region-handle region-handle-left',
        style: {
          ...handleStyle,
          left: '0',
          // borderTopLeftRadius: '8px',
          // borderBottomLeftRadius: '8px',
        },
      },
      element,
    )

    const rightHandle = createElement(
      'div',
      {
        part: 'region-handle region-handle-right',
        style: {
          ...handleStyle,
          right: '0',
          // borderTopRightRadius: '8px',
          // borderBottomRightRadius: '8px',
        },
      },
      element,
    )

    // Resize
    const resizeThreshold = 1
    this.subscriptions.push(
      makeDraggable(
        leftHandle,
        (dx, dy, x, y, element) => this.onResize(dx, 'start', element),
        () => null,
        () => this.onEndResizing(),
        resizeThreshold,
        0,
        100,
        'start'
      ),
      makeDraggable(
        rightHandle,
        (dx, dy, x, y, element) => this.onResize(dx, 'end', element),
        () => null,
        () => this.onEndResizing(),
        resizeThreshold,
        0,
        100,
        'end'
      ),
    )
  }

  private removeResizeHandles(element: HTMLElement) {
    const leftHandle = element.querySelector('[part*="region-handle-left"]')
    const rightHandle = element.querySelector('[part*="region-handle-right"]')
    if (leftHandle) {
      element.removeChild(leftHandle)
    }
    if (rightHandle) {
      element.removeChild(rightHandle)
    }
  }

  private initElement() {
    const isMarker = this.start === this.end

    let elementTop = 0
    let elementHeight = 100

    if (this.channelIdx >= 0 && this.channelIdx < this.numberOfChannels) {
      elementHeight = 100 / this.numberOfChannels
      elementTop = elementHeight * this.channelIdx
    }

    const element = createElement('div', {
      style: {
        position: 'absolute',
        top: `${elementTop}%`,
        height: `${elementHeight}%`,
        backgroundColor: isMarker ? 'none' : this.color,
        borderLeft: isMarker ? '2px solid ' + this.color : 'none',
        borderRadius: '8px',
        boxSizing: 'border-box',
        // transition: 'background-color 0.2s ease',
        cursor: this.drag ? 'grab' : 'default',
        pointerEvents: 'all',
      },
    })
    element.tabIndex = 0

    // Add resize handles
    if (!isMarker && this.resize) {
      this.addResizeHandles(element)
    }

    return element
  }

  private renderPosition() {
    const start = this.start / this.totalDuration
    const end = (this.totalDuration - this.end) / this.totalDuration
    this.element.style.left = `${start * 100}%`
    this.element.style.right = `${end * 100}%`

    this.startPercentPosition = start * 100
    this.endPercentPosition = 100 - (end * 100)

    if (this.divForDuration) {
      const elementWidth = this.element.getBoundingClientRect().width
      this.divForDuration.style.display = elementWidth && elementWidth < 80 ? 'none' : ''
      this.divForDuration.textContent = this.parseDuration(this.end - this.start)
    }
  }

  private parseDuration(seconds: number): string {
    let hours: number = Math.floor(seconds / 3600);
    let minutes: number = Math.floor((seconds % 3600) / 60);
    let secs: string = (seconds % 60).toFixed(1);
    let minutesStr: string = minutes < 10 ? '0' + minutes : minutes.toString();
    let secsStr: string = Number(secs) < 10 ? '0' + secs.toString() : secs.toString();
    return `${hours > 0 ? hours + ':' : ''}${minutesStr}:${secsStr}`;
  }

  private toggleCursor(toggle: boolean) {
    if (!this.drag || !this.element?.style) return
    this.element.style.cursor = toggle ? 'grabbing' : 'grab'
  }

  private initMouseEvents() {
    const { element } = this
    if (!element) return

    element.addEventListener('click', (e) => this.emit('click', e))
    element.addEventListener('mouseup', (e) => this.emit('mouseup', e))
    element.addEventListener('mouseenter', (e) => this.emit('over', e))
    element.addEventListener('mouseleave', (e) => this.emit('leave', e))
    element.addEventListener('dblclick', (e) => this.emit('dblclick', e))
    element.addEventListener('pointerdown', () => this.toggleCursor(true))
    element.addEventListener('pointerup', () => this.toggleCursor(false))

    // Drag
    this.subscriptions.push(
      makeDraggable(
        element,
        (dx, dy, x, y, element) => this.onMove(dx, element),
        () => this.toggleCursor(true),
        () => {
          this.toggleCursor(false)
          this.drag && this.emit('update-end')
        },
      ),
    )

    if (this.contentEditable && this.content) {
      this.content.addEventListener('click', (e) => this.onContentClick(e))
      this.content.addEventListener('mouseup', (e) => this.onContentMouseUp(e))
      this.content.addEventListener('blur', () => this.onContentBlur())
    }
  }

  public _onUpdate(dx: number, side?: 'start' | 'end' | null, element?: HTMLElement | null) {
    if (!this.element.parentElement) return
    const { width } = this.element.parentElement.getBoundingClientRect()
    const deltaSeconds = (dx / width) * this.totalDuration
    let newStart = !side || side === 'start' ? this.start + deltaSeconds : this.start
    let newEnd = !side || side === 'end' ? this.end + deltaSeconds : this.end
    const length = newEnd - newStart

    let overlapWithAnotherRegion = false
    if (this.regionsList.length) {
      if (this.regionsList[this.regionsListIndex-1] && newStart < this.regionsList[this.regionsListIndex-1].end) {
        newStart = this.regionsList[this.regionsListIndex-1].end + 0.000000001
        if (side) { newEnd = newStart + (newEnd - newStart) }
        else { newEnd = newStart + (this.end - this.start) }
        overlapWithAnotherRegion = true
      }
      else if (this.regionsList[this.regionsListIndex+1] && newEnd > this.regionsList[this.regionsListIndex+1].start) {
        newEnd = this.regionsList[this.regionsListIndex+1].start - 0.000000001
        if (side) { newStart = newEnd - (newEnd - newStart) }
        else { newStart = newEnd - (this.end - this.start) }
        overlapWithAnotherRegion = true
      }
    }

    if ( overlapWithAnotherRegion
        || (newStart >= 0
            && newEnd <= this.totalDuration
            && newStart <= newEnd
            && length >= this.minLength
            && length <= this.maxLength)
    ) {
      this.start = newStart
      this.end = newEnd

      this.renderPosition()

      this.emit('update', side, element, dx)
    }
    if (overlapWithAnotherRegion) {
      console.log('STOPPED BY OVERLAP')
      this.stopRunScrollAdjuster()
    }
  }
//////////////////////////////////////////////////////////////////////
  private adjustScroll(dx= 0, side: any, element: HTMLElement | null | undefined) {
    if (!element) return
    let scrollContainer
    if (side) {
      scrollContainer = element?.parentElement?.parentElement?.parentElement?.parentElement
    }
    else {
      scrollContainer = element?.parentElement?.parentElement?.parentElement
    }
    if (!scrollContainer) return
    const { clientWidth, scrollWidth } = scrollContainer
    if (scrollWidth <= clientWidth) return
    const scrollBbox = scrollContainer.getBoundingClientRect()
    const bbox = element.getBoundingClientRect()
    const left = bbox.left - scrollBbox.left
    const right = bbox.right - scrollBbox.left
    if (side) {
      if (left < 120 && dx < 0) {
        const speed = 120 - left
        this.runScrollAdjuster(false, speed, element, dx, side)
      }
      else if (right > clientWidth - 120 && dx > 0) {
        const speed = clientWidth - 120 - right
        this.runScrollAdjuster(true, speed, element, dx, side)
      }
      else {
        this.stopRunScrollAdjuster()
      }
    }
    else {
      if (left < 0 && bbox.width < clientWidth && dx < 0) {
        scrollContainer.scrollLeft += left
      }
      else if (right > clientWidth && bbox.width < clientWidth && dx > 0) {
        scrollContainer.scrollLeft += right - clientWidth
      }
      else {
        this.stopRunScrollAdjuster()
      }
    }
  }
  private runScrollAdjuster(direction = false, speed = 0, element: HTMLElement, dx= 0, side: any) {
    console.log('runScrollAdjuster ' , speed)
    if (speed > 15) { speed = 15 }
    else if (speed < -15) { speed = -15 }
    this.stopRunScrollAdjuster()
    const scrollContainer = element?.parentElement?.parentElement?.parentElement?.parentElement
    if (!scrollContainer) { return }
    this.runScrollAdjuster_Interval = setInterval(()=>{
      if (direction && dx > 0 && scrollContainer.scrollLeft < scrollContainer.scrollWidth) {
        scrollContainer.scrollLeft -= speed
        this._onUpdate(-speed, side, element)
      }
      if (!direction && dx < 0 && scrollContainer.scrollLeft > 0) {
        scrollContainer.scrollLeft -= speed
        this._onUpdate(-speed, side, element)
      }
    }, 30)
  }
  private stopRunScrollAdjuster() {
    console.log('stopRunScrollAdjuster')
    clearInterval(this.runScrollAdjuster_Interval)
  }
//////////////////////////////////////////////////////////////////////
  private onMove(dx: number, element?: HTMLElement | null) {
    if (!this.drag) return
    this._onUpdate(dx, null, element)
    this.adjustScroll(dx, null, element)
  }

  private onResize(dx: number, side: 'start' | 'end' | null, element?: HTMLElement | null) {
    if (!this.resize) return
    this._onUpdate(dx, side, element)
    this.adjustScroll(dx, side, element)
  }

  private onEndResizing() {
    if (!this.resize) return
    this.emit('update-end')
  }

  private onContentClick(event: MouseEvent) {
    event.stopPropagation()
    const contentContainer = event.target as HTMLDivElement
    contentContainer.focus()
    this.emit('click', event)
  }
  private onContentMouseUp(event: MouseEvent) {
    this.emit('mouseup', event)
  }

  public onContentBlur() {
    this.emit('update-end')
  }

  public _setTotalDuration(totalDuration: number) {
    this.totalDuration = totalDuration
    this.renderPosition()
  }

  /** Play the region from the start */
  public play() {
    this.emit('play')
  }

  /** Set the HTML content of the region */
  public setContent(content: RegionParams['content']) {
    this.content?.remove()
    if (!content) {
      this.content = undefined
      return
    }
    if (typeof content === 'string') {
      const isMarker = this.start === this.end
      this.content = createElement('div', {
        style: {
          padding: `0.2em ${isMarker ? 0.2 : 0.4}em`,
          display: 'inline-block',
        },
        textContent: content,
      })
    } else {
      this.content = content
    }
    if (this.contentEditable) {
      this.content.contentEditable = 'true'
    }
    this.content.setAttribute('part', 'region-content')
    this.element.appendChild(this.content)
  }

  /** Set DIV to the region for showing region duration */
  public setDivForDuration() {
    const isMarker = this.start === this.end
    if (isMarker) { return }
    const divForDuration = createElement('div', {
      style: {},
    })
    divForDuration.setAttribute('part', 'region-div-duration')
    this.element.appendChild(divForDuration)
    return divForDuration
  }

  /** Update the region's options */
  public setOptions(options: Omit<RegionParams, 'minLength' | 'maxLength'>) {
    if (options.color) {
      this.color = options.color
      this.element.style.backgroundColor = this.color
    }

    if (options.drag !== undefined) {
      this.drag = options.drag
      this.element.style.cursor = this.drag ? 'grab' : 'default'
    }

    if (options.start !== undefined || options.end !== undefined) {
      const isMarker = this.start === this.end
      this.start = this.clampPosition(options.start ?? this.start)
      this.end = this.clampPosition(options.end ?? (isMarker ? this.start : this.end))
      this.renderPosition()
      this.setPart()
    }

    if (options.content) {
      this.setContent(options.content)
    }

    if (options.id) {
      this.id = options.id
      this.setPart()
    }

    if (options.resize !== undefined && options.resize !== this.resize) {
      const isMarker = this.start === this.end
      this.resize = options.resize
      if (this.resize && !isMarker) {
        this.addResizeHandles(this.element)
      } else {
        this.removeResizeHandles(this.element)
      }
    }
  }

  /** Remove the region */
  public remove() {
    this.emit('remove')
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.element.remove()
    // This violates the type but we want to clean up the DOM reference
    // w/o having to have a nullable type of the element
    this.element = null as unknown as HTMLElement
  }
}

class RegionsPlugin extends BasePlugin<RegionsPluginEvents, RegionsPluginOptions> {
  private regions: Region[] = []
  private regionsContainer: HTMLElement
  private regionIn: Region | null = null

  public regionsGreyedOut: HTMLElement

  /** Create an instance of RegionsPlugin */
  constructor(options?: RegionsPluginOptions) {
    super(options)
    this.regionsContainer = this.initRegionsContainer()
    this.regionsGreyedOut = this.initRegionsGreyedOut()
    this.regionsContainer.appendChild(this.regionsGreyedOut)
  }

  /** Create an instance of RegionsPlugin */
  public static create(options?: RegionsPluginOptions) {
    return new RegionsPlugin(options)
  }

  /** Called by wavesurfer, don't call manually */
  onInit() {
    if (!this.wavesurfer) {
      throw Error('WaveSurfer is not initialized')
    }
    this.wavesurfer.getWrapper().appendChild(this.regionsContainer)

    // this.regionIn = null

    let activeRegions: Region[] = []
    this.subscriptions.push(
      this.wavesurfer.on('timeupdate', (currentTime) => {
        // Detect when regions are being played
        const playedRegions = this.regions.filter(
          (region) =>
            region.start <= currentTime &&
            (region.end === region.start ? region.start + 0.05 : region.end) >= currentTime,
        )

        // Trigger region-in when activeRegions doesn't include a played regions
        // playedRegions.forEach((region) => {
        //   if (!activeRegions.includes(region)) {
        //     this.emit('region-in', region)
        //   }
        // })
        if (this.wavesurfer?.isPlaying()) {
          let regionInFound = false
          for (let i = 0; i < this.regions.length; i++) {
            if (currentTime >= this.regions[i].start && currentTime <= this.regions[i].end) {
              regionInFound = true
              if (!this.regionIn || this.regionIn !== this.regions[i]) {
                this.regionIn = this.regions[i]
                this.emit('region-in',  this.regions[i])
              }
              break
            }
          }
          if (!regionInFound && this.regionIn) {
            this.emit('region-out', this.regionIn)
            this.regionIn = null
          }
        }
        // Update activeRegions only played regions
        activeRegions = playedRegions
      }),
    )
  }

  private initRegionsContainer(): HTMLElement {
    return createElement('div', {
      style: {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: '3',
        pointerEvents: 'none',
      },
    })
  }
  private initRegionsGreyedOut(): HTMLElement {
    // classList.add
    const elem = createElement('div', {
      style: {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      },
    })
    elem.classList.add('greyed_out_regions')
    return elem
  }



  private updateRegionsGreyedOut() {
    let gradientLine = ''
    const dark = '#00000075'
    const light = '#00000000'
    const totalDuration = this.wavesurfer ? this.wavesurfer.getDuration() : 0
    if (!totalDuration) {
      console.error('totalDuration: ', totalDuration)
    }
    this.regions.forEach((r, i) => {
      const start = r.startPercentPosition.toFixed(5)
      const end = r.endPercentPosition.toFixed(5)
      if (i === 0) {
        if (r.start === 0) {
          gradientLine += `${light} ${start}%, ${light} ${end}%`
        }
        else {
          gradientLine += `${dark} 0%, ${dark} ${start}%, ${light} ${start}%, ${light} ${end}%`
        }

        const plusRegionStart = this.regions[i+1] ? this.regions[i+1].startPercentPosition.toFixed(5) : false
        if (r.end !== totalDuration && plusRegionStart && plusRegionStart !== end) {
          gradientLine += `, ${dark} ${end}%`
        }
        else if (!plusRegionStart) {
          gradientLine += `, ${dark} ${end}%, ${dark} 100%`
        }
      }
      else {
        const minusRegionEnd = this.regions[i-1].endPercentPosition.toFixed(5)
        if (minusRegionEnd !== start) {
          gradientLine += `, ${dark} ${start}%, ${light} ${start}%`
        }
        gradientLine += `, ${light} ${end}%`
        if (r.end !== totalDuration) {
          gradientLine += `, ${dark} ${end}%`
        }
        if (i === this.regions.length - 1 && r.end !== totalDuration) {
          gradientLine += `, ${dark} 100%`
        }
      }
    })

    this.regionsGreyedOut.style.background = ` linear-gradient(to right, ${gradientLine})`
  }

  /** Get all created regions */
  public getRegions(): Region[] {
    return this.regions
  }

  private avoidOverlapping(region: Region) {
    if (!region.content) return

    setTimeout(() => {
      // Check that the label doesn't overlap with other labels
      // If it does, push it down until it doesn't
      const div = region.content as HTMLElement
      const box = div.getBoundingClientRect()

      const overlap = this.regions
        .map((reg) => {
          if (reg === region || !reg.content) return 0

          const otherBox = reg.content.getBoundingClientRect()
          if (box.left < otherBox.left + otherBox.width && otherBox.left < box.left + box.width) {
            return otherBox.height
          }
          return 0
        })
        .reduce((sum, val) => sum + val, 0)

      div.style.marginTop = `${overlap}px`
    }, 10)
  }



  private virtualAppend(region: Region, container: HTMLElement, element: HTMLElement) {

    const renderIfVisible = () => {
      if (!this.wavesurfer) return
      const clientWidth = this.wavesurfer.getWidth()
      const scrollLeft = this.wavesurfer.getScroll()
      const scrollWidth = container.clientWidth
      const duration = this.wavesurfer.getDuration()
      const start = Math.round((region.start / duration) * scrollWidth)
      const width = Math.round(((region.end - region.start) / duration) * scrollWidth) || 1

      // Check if the region is between the scrollLeft and scrollLeft + clientWidth
      const isVisible = start + width > scrollLeft && start < scrollLeft + clientWidth

      if (isVisible) {
        container.appendChild(element)
      } else {
        element.remove()
      }
    }

    setTimeout(() => {
      if (!this.wavesurfer) return
      renderIfVisible()

      const unsubscribe = this.wavesurfer.on('scroll', renderIfVisible)
      this.subscriptions.push(region.once('remove', unsubscribe), unsubscribe)
    }, 0)
  }

  private saveRegion(region: Region) {
    this.virtualAppend(region, this.regionsContainer, region.element)
    this.avoidOverlapping(region)
    this.regions.push(region)

    const regionSubscriptions = [
      region.on('update', (side, element, dx) => {
        this.updateRegionsGreyedOut()
        // Undefined side indicates that we are dragging not resizing
      }),

      region.on('update-end', () => {
        this.avoidOverlapping(region)
        this.emit('region-updated', region)
      }),

      region.on('play', () => {
        this.wavesurfer?.play()
        this.wavesurfer?.setTime(region.start)
      }),

      region.on('click', (e) => {
        this.emit('region-clicked', region, e)
      }),
      region.on('mouseup', (e) => {
        this.emit('region-mouseup', region, e)
      }),

      region.on('dblclick', (e) => {
        this.emit('region-double-clicked', region, e)
      }),

      // Remove the region from the list when it's removed
      region.once('remove', () => {
        regionSubscriptions.forEach((unsubscribe) => unsubscribe())
        this.regions = this.regions.filter((reg) => reg !== region)
        this.emit('region-removed', region)
      }),
    ]

    this.subscriptions.push(...regionSubscriptions)

    this.emit('region-created', region)
  }

  /** Create a region with given parameters */
  public addRegion(options: RegionParams): Region {
    if (!this.wavesurfer) {
      throw Error('WaveSurfer is not initialized')
    }

    const duration = this.wavesurfer.getDuration()
    const numberOfChannels = this.wavesurfer?.getDecodedData()?.numberOfChannels
    const region = new Region(options, duration, numberOfChannels)

    if (!duration) {
      this.subscriptions.push(
        this.wavesurfer.once('ready', (duration) => {
          region._setTotalDuration(duration)
          this.saveRegion(region)
        }),
      )
    } else {
      this.saveRegion(region)
    }

    return region
  }

  /**
   * Enable creation of regions by dragging on an empty space on the waveform.
   * Returns a function to disable the drag selection.
   */
  public enableDragSelection(options: Omit<RegionParams, 'start' | 'end'>, threshold = 3): () => void {
    const wrapper = this.wavesurfer?.getWrapper()
    if (!wrapper || !(wrapper instanceof HTMLElement)) return () => undefined

    const initialSize = 5
    let region: Region | null = null
    let startX = 0

    return makeDraggable(
      wrapper,

      // On drag move
      (dx, _dy, x) => {
        if (region) {
          // Update the end position of the region
          // If we're dragging to the left, we need to update the start instead
          region._onUpdate(dx, x > startX ? 'end' : 'start')
        }
      },

      // On drag start
      (x) => {
        startX = x
        if (!this.wavesurfer) return
        const duration = this.wavesurfer.getDuration()
        const numberOfChannels = this.wavesurfer?.getDecodedData()?.numberOfChannels
        const { width } = this.wavesurfer.getWrapper().getBoundingClientRect()
        // Calculate the start time of the region
        const start = (x / width) * duration
        // Give the region a small initial size
        const end = ((x + initialSize) / width) * duration

        // Create a region but don't save it until the drag ends
        region = new Region(
          {
            ...options,
            start,
            end,
          },
          duration,
          numberOfChannels,
        )
        // Just add it to the DOM for now
        this.regionsContainer.appendChild(region.element)
      },

      // On drag end
      () => {
        if (region) {
          this.saveRegion(region)
          region = null
        }
      },

      threshold,
    )
  }

  /** Remove all regions */
  public clearRegions() {
    this.regions.forEach((region) => region.remove())
  }

  /** Destroy the plugin and clean up */
  public destroy() {
    this.clearRegions()
    super.destroy()
    this.regionsContainer.remove()
  }
}

export default RegionsPlugin
