import * as echarts from 'echarts/core';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { LegacyGridContainLabel } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  HeatmapChart,
  LegendComponent,
  LegacyGridContainLabel,
  LineChart,
  MarkLineComponent,
  PieChart,
  TooltipComponent,
  VisualMapComponent,
]);

export { echarts };
