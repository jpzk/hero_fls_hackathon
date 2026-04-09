FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV COLMAP_VERSION=3.9.1

# System deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    ffmpeg \
    git cmake build-essential \
    libboost-program-options-dev libboost-filesystem-dev libboost-graph-dev \
    libboost-system-dev libboost-test-dev \
    libeigen3-dev libflann-dev libfreeimage-dev libmetis-dev \
    libgoogle-glog-dev libgflags-dev libsqlite3-dev \
    libglew-dev qtbase5-dev libqt5opengl5-dev libcgal-dev libceres-dev \
    && rm -rf /var/lib/apt/lists/*

# Build COLMAP
RUN git clone --branch ${COLMAP_VERSION} --depth 1 https://github.com/colmap/colmap.git /tmp/colmap && \
    cd /tmp/colmap && mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_CUDA_ARCHITECTURES="70;75;80;86;89;90" && \
    make -j$(nproc) && make install && \
    rm -rf /tmp/colmap

WORKDIR /workspace

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY pipeline.py .

ENTRYPOINT ["python3", "pipeline.py"]
