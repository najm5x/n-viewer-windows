import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import {
  calculateDisplayDimensions,
  clampZoom,
  normalizeScaleMode
} from './pdf-layout.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_RENDERED_PAGES = 18;
const MAX_OUTPUT_SCALE = 2;
const RENDER_CONCURRENCY = 2;

function isRenderingCancellation(error) {
  return error?.name === 'RenderingCancelledException' || error?.name === 'AbortException';
}

export class PdfViewer {
  constructor({ scrollRoot, pagesContainer, onLoading, onError, onStatus, requestPassword }) {
    this.scrollRoot = scrollRoot;
    this.pagesContainer = pagesContainer;
    this.onLoading = onLoading;
    this.onError = onError;
    this.onStatus = onStatus;
    this.requestPassword = requestPassword;

    this.zoom = 1;
    this.scaleMode = 'fit-width';
    this.currentPage = 1;
    this.generation = 0;
    this.viewRevision = 0;
    this.queue = [];
    this.activeRenders = 0;
    this.pageRecords = [];
    this.renderedOrder = [];
    this.visiblePages = new Set();
    this.resizeTimer = null;
    this.scrollTimer = null;
    this.defaultBaseViewport = null;

    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.invalidateLayout(), 160);
    });
    this.resizeObserver.observe(this.scrollRoot);

    this.scrollRoot.addEventListener('scroll', () => {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.updateCurrentPage(), 45);
    }, { passive: true });
  }

  getLayoutOptions(baseViewport) {
    const compact = this.scrollRoot.clientWidth < 720;
    return {
      mode: this.scaleMode,
      zoom: this.zoom,
      pageWidth: baseViewport.width,
      pageHeight: baseViewport.height,
      containerWidth: this.scrollRoot.clientWidth,
      containerHeight: this.scrollRoot.clientHeight,
      horizontalPadding: compact ? 20 : 48,
      // Includes the page stack's top/bottom padding, page gap, and HUD clearance.
      verticalPadding: compact ? 136 : 164
    };
  }

  getDisplayDimensions(baseViewport) {
    return calculateDisplayDimensions(this.getLayoutOptions(baseViewport));
  }

  emitStatus() {
    this.onStatus({
      currentPage: this.currentPage,
      totalPages: this.pageRecords.length,
      zoom: this.zoom,
      scaleMode: this.scaleMode
    });
  }

  async open(sourceUrl, initialPage = 1) {
    await this.close();
    const generation = ++this.generation;
    this.zoom = 1;
    this.currentPage = 1;
    this.onLoading(true, 'Opening PDF…');

    try {
      this.loadingTask = pdfjsLib.getDocument({
        url: sourceUrl,
        enableXfa: true,
        isEvalSupported: false,
        useSystemFonts: true
      });

      this.loadingTask.onPassword = async (updatePassword, reason) => {
        const password = await this.requestPassword(reason);
        if (password === null) {
          await this.loadingTask.destroy();
          return;
        }
        updatePassword(password);
      };

      this.pdf = await this.loadingTask.promise;
      if (generation !== this.generation) return;

      const firstPage = await this.pdf.getPage(1);
      this.defaultBaseViewport = firstPage.getViewport({ scale: 1 });

      this.createPageSlots(this.pdf.numPages, firstPage);
      this.createIntersectionObserver();
      const targetPage = Math.min(this.pdf.numPages, Math.max(1, Number.parseInt(initialPage, 10) || 1));
      this.currentPage = targetPage;
      this.emitStatus();
      this.queuePage(targetPage - 1, true);
      requestAnimationFrame(() => this.goToPage(targetPage));
    } catch (error) {
      if (generation === this.generation && !isRenderingCancellation(error)) this.onError(error);
    } finally {
      if (generation === this.generation) this.onLoading(false);
    }
  }

  createPlaceholder(pageNumber) {
    const placeholder = document.createElement('div');
    placeholder.className = 'pdf-page-placeholder';
    placeholder.textContent = `Page ${pageNumber}`;
    return placeholder;
  }

  createPageSlots(count, firstPage) {
    this.pagesContainer.replaceChildren();
    this.pageRecords = [];

    for (let index = 0; index < count; index += 1) {
      const wrapper = document.createElement('section');
      wrapper.className = 'pdf-page';
      wrapper.dataset.pageIndex = String(index);
      wrapper.setAttribute('aria-label', `Page ${index + 1}`);
      wrapper.append(this.createPlaceholder(index + 1));
      this.pagesContainer.append(wrapper);

      const record = {
        index,
        wrapper,
        page: index === 0 ? firstPage : null,
        baseViewport: index === 0 ? this.defaultBaseViewport : null,
        canvas: null,
        textLayerBuilder: null,
        renderTask: null,
        rendering: false,
        renderedKey: null,
        queued: false,
        visible: false,
        needsRerender: false
      };
      this.pageRecords.push(record);
      this.updateSlotDimensions(record);
    }
  }

  updateSlotDimensions(record) {
    const baseViewport = record.baseViewport ?? this.defaultBaseViewport;
    if (!baseViewport) return;
    const { scale, width, height } = this.getDisplayDimensions(baseViewport);
    record.wrapper.style.width = `${width}px`;
    record.wrapper.style.height = `${height}px`;
    record.wrapper.style.setProperty('--total-scale-factor', String(scale));

    if (record.canvas) {
      const currentWidth = Number.parseFloat(record.canvas.style.width) || 0;
      const currentHeight = Number.parseFloat(record.canvas.style.height) || 0;
      if (Math.abs(currentWidth - width) > 0.25 || Math.abs(currentHeight - height) > 0.25) {
        record.canvas.style.width = `${width}px`;
        record.canvas.style.height = `${height}px`;
        record.wrapper.classList.add('is-rescaling');
      }
    }
  }

  createIntersectionObserver() {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number(entry.target.dataset.pageIndex);
        const record = this.pageRecords[index];
        if (!record) continue;
        record.visible = entry.isIntersecting;
        if (entry.isIntersecting) {
          this.visiblePages.add(index);
          this.queuePage(index);
        } else {
          this.visiblePages.delete(index);
        }
      }
      this.updateCurrentPage();
    }, {
      root: this.scrollRoot,
      rootMargin: '1100px 0px',
      threshold: 0.01
    });

    for (const record of this.pageRecords) this.intersectionObserver.observe(record.wrapper);
  }

  queuePage(index, priority = false) {
    const record = this.pageRecords[index];
    if (!record) return;
    if (record.rendering) {
      record.needsRerender = true;
      return;
    }
    if (record.queued) return;

    record.queued = true;
    if (priority) this.queue.unshift(index);
    else this.queue.push(index);
    this.processQueue();
  }

  processQueue() {
    while (this.activeRenders < RENDER_CONCURRENCY && this.queue.length > 0) {
      const index = this.queue.shift();
      const record = this.pageRecords[index];
      if (!record) continue;
      record.queued = false;
      this.activeRenders += 1;
      this.renderPage(record)
        .catch((error) => {
          if (!isRenderingCancellation(error)) console.warn('Page render failed:', error);
        })
        .finally(() => {
          this.activeRenders -= 1;
          this.processQueue();
        });
    }
  }

  async renderPage(record) {
    if (!this.pdf || record.rendering) return;

    const generation = this.generation;
    const revision = this.viewRevision;
    record.rendering = true;
    record.needsRerender = false;

    let nextTextLayerBuilder = null;

    try {
      record.page ??= await this.pdf.getPage(record.index + 1);
      if (generation !== this.generation) return;

      record.baseViewport = record.page.getViewport({ scale: 1 });
      const { scale: displayScale, width, height } = this.getDisplayDimensions(record.baseViewport);
      const outputScale = Math.min(window.devicePixelRatio || 1, MAX_OUTPUT_SCALE);
      const renderKey = `${displayScale.toFixed(5)}:${outputScale.toFixed(2)}`;

      this.updateSlotDimensions(record);
      if (record.renderedKey === renderKey && !record.needsRerender) {
        this.touchRendered(record.index);
        return;
      }

      const displayViewport = record.page.getViewport({ scale: displayScale });
      const renderViewport = record.page.getViewport({ scale: displayScale * outputScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(renderViewport.width));
      canvas.height = Math.max(1, Math.ceil(renderViewport.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.setAttribute('aria-hidden', 'true');

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Unable to create a PDF rendering surface.');

      record.renderTask = record.page.render({
        canvasContext: context,
        viewport: renderViewport,
        intent: 'display'
      });
      await record.renderTask.promise;

      if (generation !== this.generation || revision !== this.viewRevision) return;

      try {
        nextTextLayerBuilder = new TextLayerBuilder({ pdfPage: record.page });
        nextTextLayerBuilder.div.style.setProperty('--total-scale-factor', String(displayViewport.scale));
        await nextTextLayerBuilder.render({
          viewport: displayViewport,
          textContentParams: {
            includeMarkedContent: true,
            disableNormalization: true
          }
        });
      } catch (error) {
        nextTextLayerBuilder?.cancel();
        nextTextLayerBuilder = null;
        console.warn(`Text selection is unavailable on page ${record.index + 1}:`, error);
      }

      if (generation !== this.generation || revision !== this.viewRevision) {
        nextTextLayerBuilder?.cancel();
        return;
      }

      record.textLayerBuilder?.cancel();
      record.wrapper.style.width = `${displayViewport.width}px`;
      record.wrapper.style.height = `${displayViewport.height}px`;
      record.wrapper.style.setProperty('--total-scale-factor', String(displayViewport.scale));
      record.wrapper.replaceChildren(
        canvas,
        ...(nextTextLayerBuilder ? [nextTextLayerBuilder.div] : [])
      );
      record.wrapper.classList.add('is-rendered');
      record.wrapper.classList.remove('is-rescaling');

      record.canvas = canvas;
      record.textLayerBuilder = nextTextLayerBuilder;
      record.renderedKey = renderKey;
      nextTextLayerBuilder = null;

      this.touchRendered(record.index);
      this.evictDistantPages();
    } finally {
      nextTextLayerBuilder?.cancel();
      record.rendering = false;
      record.renderTask = null;

      if (
        generation === this.generation &&
        (record.needsRerender || revision !== this.viewRevision)
      ) {
        record.needsRerender = false;
        this.queuePage(record.index, true);
      }
    }
  }

  touchRendered(index) {
    this.renderedOrder = this.renderedOrder.filter((value) => value !== index);
    this.renderedOrder.push(index);
  }

  evictDistantPages() {
    while (this.renderedOrder.length > MAX_RENDERED_PAGES) {
      const index = this.renderedOrder.shift();
      if (this.visiblePages.has(index)) {
        this.renderedOrder.push(index);
        if (this.renderedOrder.every((value) => this.visiblePages.has(value))) break;
        continue;
      }

      const record = this.pageRecords[index];
      if (!record || record.rendering) continue;
      record.textLayerBuilder?.cancel();
      record.textLayerBuilder = null;
      record.canvas = null;
      record.renderedKey = null;
      record.wrapper.classList.remove('is-rendered', 'is-rescaling');
      record.wrapper.replaceChildren(this.createPlaceholder(index + 1));
      record.page?.cleanup();
      record.page = null;
      record.baseViewport = null;
      this.updateSlotDimensions(record);
    }
  }

  invalidateLayout() {
    if (!this.pdf || !this.pageRecords.length) return;

    this.viewRevision += 1;
    for (const record of this.pageRecords) this.updateSlotDimensions(record);

    for (const index of this.visiblePages) {
      const record = this.pageRecords[index];
      if (!record) continue;
      record.renderedKey = null;
      if (record.rendering) {
        record.needsRerender = true;
        record.renderTask?.cancel();
      } else {
        this.queuePage(index, true);
      }
    }
    this.emitStatus();
  }

  updateCurrentPage() {
    if (!this.pageRecords.length) return;

    const rootRect = this.scrollRoot.getBoundingClientRect();
    const center = rootRect.top + rootRect.height / 2;
    const candidates = this.visiblePages.size
      ? [...this.visiblePages].map((index) => this.pageRecords[index]).filter(Boolean)
      : this.pageRecords;

    let bestIndex = Math.max(0, this.currentPage - 1);
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const record of candidates) {
      const rect = record.wrapper.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = record.index;
      }
    }

    this.currentPage = bestIndex + 1;
    this.emitStatus();
  }


  goToPage(pageNumber) {
    if (!this.pageRecords.length) return 1;
    const normalized = Math.min(this.pageRecords.length, Math.max(1, Number.parseInt(pageNumber, 10) || 1));
    const record = this.pageRecords[normalized - 1];
    this.currentPage = normalized;
    this.queuePage(normalized - 1, true);
    if (record) {
      const top = Math.max(0, record.wrapper.offsetTop - 12);
      this.scrollRoot.scrollTo({ top, behavior: 'auto' });
    }
    this.emitStatus();
    return normalized;
  }

  setScaleMode(mode) {
    const normalized = normalizeScaleMode(mode);
    if (this.scaleMode === normalized) return normalized;
    this.scaleMode = normalized;
    this.invalidateLayout();
    return normalized;
  }

  setZoom(value) {
    const normalized = clampZoom(value);
    if (this.zoom === normalized) return normalized;
    this.zoom = normalized;
    this.invalidateLayout();
    return normalized;
  }

  zoomIn() { return this.setZoom(this.zoom + 0.1); }
  zoomOut() { return this.setZoom(this.zoom - 0.1); }
  resetZoom() { return this.setZoom(1); }

  async close() {
    this.generation += 1;
    this.viewRevision += 1;
    this.intersectionObserver?.disconnect();
    this.queue.length = 0;

    for (const record of this.pageRecords) {
      record.needsRerender = false;
      record.renderTask?.cancel();
      record.textLayerBuilder?.cancel();
    }

    try { await this.loadingTask?.destroy(); } catch {}
    try { await this.pdf?.destroy(); } catch {}

    this.loadingTask = null;
    this.pdf = null;
    this.defaultBaseViewport = null;
    this.pageRecords = [];
    this.renderedOrder = [];
    this.visiblePages.clear();
    this.pagesContainer.replaceChildren();
    this.currentPage = 1;
  }
}
