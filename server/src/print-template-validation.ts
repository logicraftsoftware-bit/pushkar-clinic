import {z} from "zod";
export const printTemplateBody=z.object({
  header_image:z.string().max(8_000_000,"Header image is too large. Crop or resize it before saving.").default(""),
  footer_content:z.string().max(8_000_000,"Footer is too large. Crop or resize the image before saving.").default(""),
});
