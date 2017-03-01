/* global Array, Math */
import Ember from 'ember';
import layout from './template';

import keyForItem from 'vertical-collection/-private/ember/utils/key-for-item';

import estimateElementHeight from 'vertical-collection/-private/utils/element/estimate-element-height';
import closestElement from 'vertical-collection/-private/utils/element/closest';

import DynamicRadar from 'vertical-collection/-private/data-view/radar/dynamic-radar';
import StaticRadar from 'vertical-collection/-private/data-view/radar/static-radar';

import Container from 'vertical-collection/-private/data-view/container';
import getArray from 'vertical-collection/-private/data-view/utils/get-array';
import {
  addScrollHandler,
  removeScrollHandler
} from 'vertical-collection/-private/data-view/utils/scroll-handler';

const {
  computed,
  Component,
  String: { htmlSafe }
} = Ember;

const VerticalCollection = Component.extend({
  layout,

  /*
   * If itemTagName is blank or null, the `vertical-collection` will [tag match](../addon/utils/get-tag-descendant.js)
   * with the `vertical-item`.
   */
  tagName: 'vertical-collection',
  boxStyle: htmlSafe(''),

  key: '@identity',
  content: computed.deprecatingAlias('items'),

  // –––––––––––––– Required Settings

  minHeight: 75,

  // usable via {{#vertical-collection <items-array>}}
  items: null,

  // –––––––––––––– Optional Settings
  alwaysRemeasure: false,
  alwaysUseDefaultHeight: computed.not('alwaysRemeasure'),

  /*
   * A selector string that will select the element from
   * which to calculate the viewable height and needed offsets.
   *
   * This element will also have the `scroll` event handler added to it.
   *
   * Usually this element will be the component's immediate parent element,
   * if so, you can leave this null.
   *
   * Set this to "body" to scroll the entire web page.
   */
  containerSelector: null,

  // –––––––––––––– Performance Tuning
  /*
   * how much extra room to keep visible and invisible on
   * either side of the viewport.
   */
  bufferSize: 1,

  // –––––––––––––– Initial Scroll State
  /*
   *  If set, this will be used to set
   *  the scroll position at which the
   *  component initially renders.
   */
  scrollPosition: 0,

  /*
   * If set, upon initialization the scroll
   * position will be set such that the item
   * with the provided id is at the top left
   * on screen.
   *
   * If the item cannot be found, scrollTop
   * is set to 0.
   */
  idForFirstItem: null,

  /*
   * If set, if scrollPosition is empty
   * at initialization, the component will
   * render starting at the bottom.
   */
  renderFromLast: false,

  // –––––––––––––– @private

  _minHeight: computed('minHeight', function() {
    const minHeight = this.get('minHeight');

    if (typeof minHeight === 'string') {
      return estimateElementHeight(this.element, minHeight);
    } else {
      return minHeight;
    }
  }),

  _sendActions() {
    const {
      _items,

      _prevFirstItemIndex,
      _prevLastItemIndex,
      _prevFirstVisibleIndex,
      _prevLastVisibleIndex
    } = this;

    const {
      firstItemIndex,
      lastItemIndex,
      firstVisibleIndex,
      lastVisibleIndex
    } = this._radar;

    if (firstItemIndex === 0 && firstItemIndex !== _prevFirstItemIndex) {
      this.sendAction('firstReached');
    }

    if (lastItemIndex === _items.length - 1 && lastItemIndex !== _prevLastItemIndex) {
      this.sendAction('lastReached');
    }

    if (firstVisibleIndex !== _prevFirstVisibleIndex) {
      this.sendAction('firstVisibleChanged', _items[firstVisibleIndex], firstVisibleIndex);
    }

    if (lastVisibleIndex !== _prevLastVisibleIndex) {
      this.sendAction('lastVisibleChanged', _items[lastVisibleIndex], lastVisibleIndex);
    }

    this._prevFirstItemIndex = firstItemIndex;
    this._prevLastItemIndex = lastItemIndex;
    this._prevFirstVisibleIndex = firstVisibleIndex;
    this._prevLastVisibleIndex = lastVisibleIndex;
  },

  radar: computed('items.[]', function() {
    const {
      _radar,

      _prevItemsLength,
      _prevFirstKey,
      _prevLastKey
    } = this;

    const items = getArray(this.get('items'));
    const key = this.get('key');
    const lenDiff = items.length - (_prevItemsLength || 0);

    this._items = items;
    this._prevItemsLength = items.length;
    this._prevFirstKey = keyForItem(items[0], key, 0);
    this._prevLastKey = keyForItem(items[items.length - 1], key, items.length - 1);

    if (isPrepend(lenDiff, items, key, _prevFirstKey, _prevLastKey)) {
      _radar.prepend(items, lenDiff);
    } else if (isAppend(lenDiff, items, key, _prevFirstKey, _prevLastKey)) {
      _radar.append(items, lenDiff);
    } else {
      _radar.resetItems(items);
    }

    // The container element needs to have some height in order for us to set the scroll position
    // on initialization, so we set this min-height property to radar's total
    // this.element.style.minHeight = `${this._radar.total}px`;

    return this._radar;
  }),

  didUpdateAttrs() {
    this._initializeRadar();
  },

  // –––––––––––––– Setup/Teardown
  didInsertElement() {
    // The rendered {{each}} is removed from the DOM, but a reference is kept, allowing Glimmer to
    // continue rendering to the node. This enables the manual diffing strategy described above.
    this._virtualComponentRenderer = this.element.getElementsByClassName('virtual-component-renderer')[0];
    this.element.removeChild(this._virtualComponentRenderer);

    const containerSelector = this.get('containerSelector');

    this.propertyDidChange('items.[]');

    if (containerSelector === 'body') {
      this._scrollContainer = Container;
    } else {
      this._scrollContainer = containerSelector ? closestElement(containerSelector) : this.element.parentNode;
    }

    // Initialize the Radar and set the scroll state
    this._initializeRadar();
    this._initializeScrollState();
    this._initializeEventHandlers();

    console.timeEnd('vertical-collection-init'); // eslint-disable-line no-console
  },

  _isEarthquake(top) {
    if (Math.abs(this._lastEarthquake - top) > this.get('_minHeight') / 2) {
      this._lastEarthquake = top;

      return true;
    }

    return false;
  },

  /*
   * Set all of the Radar's properties, including `items`. This is a separate function from
   * `_resetRadar` because it needs to set `items` on the Radar _after_ minHeight has been set, but
   * _before_ we update the VirtualComponentPool and schedule an update. In the normal
   *
   * @private
   */
  _initializeRadar() {
    const minHeight = this.get('_minHeight');
    const bufferSize = this.get('bufferSize');
    const renderFromLast = this.get('renderFromLast');

    const {
      element,
      _scrollContainer
    } = this;

    this._radar.init(element, _scrollContainer, minHeight, bufferSize, renderFromLast);
  },

  _initializeScrollState() {
    let scrollPosition = this.get('scrollPosition');

    const renderFromLast = this.get('renderFromLast');
    const idForFirstItem = this.get('idForFirstItem');
    const key = this.get('key');

    const minHeight = this.get('_minHeight');
    const items = this.get('items');
    const maxIndex = items.length;

    let index = 0;

    if (idForFirstItem) {
      for (let i = 0; i < maxIndex; i++) {
        if (keyForItem(items[i], key, i) === idForFirstItem) {
          index = i;
          break;
        }
      }

      scrollPosition = index * minHeight;

      if (renderFromLast) {
        scrollPosition -= this._radar._scrollContainerHeight;
      }
    }

    this._radar.visibleTop = scrollPosition;

    this._scrollContainer.scrollTop = this._radar.scrollTop;
    this._lastEarthquake = this._radar.scrollTop;
  },

  _initializeEventHandlers() {
    this._scrollHandler = ({ top }) => {
      if (this._isEarthquake(top)) {
        this._radar.scrollTop = top;
      }
    };

    this._resizeHandler = () => {
      this._scheduleUpdate();
    };

    addScrollHandler(this._scrollContainer, this._scrollHandler);
    this._scrollContainer.addEventListener('resize', this._resizeHandler);

    if (this._scrollContainer !== Container) {
      this._windowScrollTop = Container.scrollTop;

      this._radarShiftHandler = ({ top }) => {
        const dY = top - this._windowScrollTop;
        this._windowScrollTop = top;

        this._radar.shiftContainers(dY);
      };

      addScrollHandler(Container, this._radarShiftHandler);
    }
  },

  willDestroy() {
    removeScrollHandler(this._scrollContainer, this._scrollHandler);
    this._scrollContainer.removeEventListener('resize', this._resizeHandler);

    if (this._radarShiftHandler) {
      removeScrollHandler(Container, this._radarShiftHandler);
    }
  },

  init() {
    console.time('vertical-collection-init'); // eslint-disable-line no-console
    this._super();

    const RadarClass = this.get('alwaysRemeasure') ? DynamicRadar : StaticRadar;

    this._radar = new RadarClass();

    this._radar.didUpdate = () => {
      this._sendActions();
    };
  }
});

VerticalCollection.reopenClass({
  positionalParams: ['items']
});

function isPrepend(lenDiff, newItems, key, oldFirstKey, oldLastKey) {
  if (lenDiff <= 0) {
    return false;
  }

  const newFirstKey = keyForItem(newItems[lenDiff], key, lenDiff);
  const newLastKey = keyForItem(newItems[newItems.length - 1], key, newItems.length - 1);

  return oldFirstKey === newFirstKey && oldLastKey === newLastKey;
}

function isAppend(lenDiff, newItems, key, oldFirstKey, oldLastKey) {
  if (lenDiff <= 0) {
    return false;
  }

  const newFirstKey = keyForItem(newItems[0], key, 0);
  const newLastKey = keyForItem(newItems[newItems.length - lenDiff - 1], key, newItems.length - lenDiff - 1);

  return oldFirstKey === newFirstKey && oldLastKey === newLastKey;
}

export default VerticalCollection;
