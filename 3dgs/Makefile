# 3D Gaussian Splatting pipeline: video → .splat
# Usage: make splat

VIDEO       := better_pov.MOV
SCENE       := data/better_pov
MODEL       := output/better_pov
ITERATIONS  := 30000
FPS         := 6
TIMESTAMP   := $(shell date +%H%M)

# CUDA + headless COLMAP
export PATH := /usr/local/cuda/bin:$(PATH)
export QT_QPA_PLATFORM := offscreen

# Derived paths
FRAMES_DIR  := $(SCENE)/input
SPARSE_DIR  := $(SCENE)/sparse/0
PLY         := $(MODEL)/point_cloud/iteration_$(ITERATIONS)/point_cloud.ply
SPLAT_OUT   := output/output_$(TIMESTAMP).splat
PLY_OUT     := output/output_$(TIMESTAMP).ply

.PHONY: splat clean deps

# Full pipeline
splat: $(PLY)
	cp $(PLY) $(PLY_OUT)
	python ply_to_splat.py $(PLY) $(SPLAT_OUT)
	@echo "Done: $(SPLAT_OUT) + $(PLY_OUT)"

# Step 0: Install CUDA submodules if needed
deps:
	pip install --break-system-packages --no-build-isolation submodules/diff-gaussian-rasterization
	pip install --break-system-packages --no-build-isolation submodules/simple-knn
	pip install --break-system-packages --no-build-isolation submodules/fused-ssim

# Step 1: Extract frames from video
$(FRAMES_DIR): $(VIDEO)
	mkdir -p $(FRAMES_DIR)
	ffmpeg -i $(VIDEO) -qscale:v 1 -qmin 1 -vf fps=$(FPS) $(FRAMES_DIR)/%04d.jpg
	@echo "Extracted $$(ls $(FRAMES_DIR)/*.jpg | wc -l) frames at $(FPS) fps"

# Step 2: COLMAP — feature extraction, matching, reconstruction, undistortion
# --no_gpu: use CPU SIFT (avoids OpenGL requirement on headless servers)
$(SPARSE_DIR): $(FRAMES_DIR)
	python convert.py -s $(SCENE) --camera OPENCV
	@echo "COLMAP reconstruction complete"

# Step 3: Train 3D Gaussian Splatting
$(PLY): $(SPARSE_DIR)
	python train.py \
		-s $(SCENE) \
		-m $(MODEL) \
		--iterations $(ITERATIONS) \
		--save_iterations $(ITERATIONS) \
		--disable_viewer
	@echo "Training complete — $(PLY)"

clean:
	rm -rf $(SCENE) $(MODEL)
