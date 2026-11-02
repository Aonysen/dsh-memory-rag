/** 测试公共工具：固定维度与单位向量构造。 */
export const DIM = 64

/** 第 index 个分量 = 1 的 64 维单位向量。 */
export function unit(index) {
  const vector = new Array(DIM).fill(0)
  vector[index % DIM] = 1
  return vector
}
