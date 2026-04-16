import mongoose from 'mongoose';
import { DEFAULT_LANG } from '../../../i18n/index.js';

const widgetBehaviorSchema = new mongoose.Schema(
  {
    defaultLocale: {
      type: String,
      trim: true,
      enum: ['en', 'ar'],
      default: DEFAULT_LANG,
    },
    collectName: {
      type: Boolean,
      default: true,
    },
    collectEmail: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
    strict: true,
  }
);

export default widgetBehaviorSchema;
